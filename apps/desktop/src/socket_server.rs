use std::collections::HashMap;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::mpsc;

use crate::peer_auth::{allowed_bridge_paths, verify_bridge_peer};
use crate::sidecar::SidecarManager;

const SOCKET_REL_PATH: &str = ".bnot/bnot.sock";
const WRITE_QUEUE_DEPTH: usize = 16;

type ClientWriter = mpsc::Sender<Vec<u8>>;

#[derive(Clone)]
pub struct SocketServerHandle {
    inner: Arc<Inner>,
}

struct Inner {
    clients: Mutex<HashMap<u64, ClientWriter>>,
}

impl SocketServerHandle {
    pub fn send_response(&self, client_id: u64, mut line: String) {
        if !line.ends_with('\n') {
            line.push('\n');
        }
        if let Some(tx) = self.inner.get_writer(client_id) {
            let _ = tx.try_send(line.into_bytes());
        }
    }

    pub fn close(&self, client_id: u64) {
        self.inner.remove_writer(client_id);
    }
}

impl Inner {
    fn get_writer(&self, client_id: u64) -> Option<ClientWriter> {
        self.clients.lock().unwrap().get(&client_id).cloned()
    }

    fn insert_writer(&self, client_id: u64, tx: ClientWriter) {
        self.clients.lock().unwrap().insert(client_id, tx);
    }

    fn remove_writer(&self, client_id: u64) {
        self.clients.lock().unwrap().remove(&client_id);
    }
}

/// Start the authenticated socket server in a background thread that owns its own
/// tokio runtime. Returns a handle that can route responses back to specific clients.
pub fn start<R: Runtime>(app: AppHandle<R>) -> SocketServerHandle {
    let inner = Arc::new(Inner {
        clients: Mutex::new(HashMap::new()),
    });
    let handle = SocketServerHandle {
        inner: inner.clone(),
    };

    let allowed = allowed_bridge_paths();
    if allowed.is_empty() {
        eprintln!(
            "[socket-server] no bnot-bridge binary found in expected locations; \
             socket server will reject all connections"
        );
    } else {
        for p in &allowed {
            eprintln!("[socket-server] accepting peer: {}", p.display());
        }
    }

    let socket_path = home_socket_path();
    thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("tokio runtime");

        rt.block_on(async move {
            run_listener(app, inner, allowed, socket_path).await;
        });
    });

    handle
}

async fn run_listener<R: Runtime>(
    app: AppHandle<R>,
    inner: Arc<Inner>,
    allowed: Vec<PathBuf>,
    socket_path: PathBuf,
) {
    if let Some(parent) = socket_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    let _ = tokio::fs::remove_file(&socket_path).await;

    let listener = match UnixListener::bind(&socket_path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!(
                "[socket-server] bind {} failed: {e}",
                socket_path.display()
            );
            return;
        }
    };

    // chmod 0600 — only owner can connect
    if let Err(e) = std::fs::set_permissions(
        &socket_path,
        std::fs::Permissions::from_mode(0o600),
    ) {
        eprintln!("[socket-server] chmod 0600 failed: {e}");
    }

    eprintln!("[socket-server] listening on {}", socket_path.display());

    let next_id = Arc::new(AtomicU64::new(1));
    loop {
        let (stream, _addr) = match listener.accept().await {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[socket-server] accept error: {e}");
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }
        };

        // Verify peer credentials before doing anything else
        match verify_bridge_peer(&stream, &allowed) {
            Ok(pid) => {
                let client_id = next_id.fetch_add(1, Ordering::Relaxed);
                let app_for_task = app.clone();
                let inner_for_task = inner.clone();
                tokio::spawn(async move {
                    handle_client(app_for_task, inner_for_task, stream, client_id, pid).await;
                });
            }
            Err(err) => {
                eprintln!("[socket-server] reject connection: {err}");
                drop(stream);
            }
        }
    }
}

async fn handle_client<R: Runtime>(
    app: AppHandle<R>,
    inner: Arc<Inner>,
    stream: UnixStream,
    client_id: u64,
    peer_pid: i32,
) {
    let (read_half, mut write_half) = stream.into_split();
    let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(WRITE_QUEUE_DEPTH);
    inner.insert_writer(client_id, write_tx);

    let writer_inner = inner.clone();
    let writer_task = tokio::spawn(async move {
        while let Some(bytes) = write_rx.recv().await {
            if write_half.write_all(&bytes).await.is_err() {
                break;
            }
        }
        let _ = write_half.shutdown().await;
        writer_inner.remove_writer(client_id);
    });

    // Reader task: split NDJSON, forward each line to sidecar
    let mut reader = BufReader::new(read_half);
    let mut line_buf = String::new();
    loop {
        line_buf.clear();
        let n = match reader.read_line(&mut line_buf).await {
            Ok(n) => n,
            Err(_) => break,
        };
        if n == 0 {
            break;
        }
        let trimmed = line_buf.trim_end_matches(['\n', '\r']);
        if trimmed.is_empty() {
            continue;
        }
        // Parse the message into a JSON Value so we can wrap it cleanly
        let msg: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(sidecar) = app.try_state::<SidecarManager>() {
            sidecar.send_request(
                "socketMessage",
                serde_json::json!({ "clientId": client_id, "message": msg }),
            );
        }
    }

    // Reader closed → tell sidecar this client disconnected
    if let Some(sidecar) = app.try_state::<SidecarManager>() {
        sidecar.send_request(
            "socketDisconnect",
            serde_json::json!({ "clientId": client_id }),
        );
    }

    // Drop the writer channel so the writer task exits cleanly.
    inner.remove_writer(client_id);
    let _ = writer_task.await;

    eprintln!("[socket-server] client {client_id} (pid {peer_pid}) disconnected");
}

fn home_socket_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home).join(SOCKET_REL_PATH)
}
