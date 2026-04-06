use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Runtime};

pub struct SidecarManager {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    next_id: Mutex<u64>,
}

impl SidecarManager {
    pub fn spawn<R: Runtime>(app: &AppHandle<R>) -> Self {
        let child: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
        let stdin: Arc<Mutex<Option<ChildStdin>>> = Arc::new(Mutex::new(None));

        let sidecar_dir = find_sidecar_dir();

        if let Some(dir) = sidecar_dir {
            match Self::start_sidecar(&dir, &child, &stdin, app) {
                Ok(()) => eprintln!("[sidecar] spawned from {:?}", dir),
                Err(e) => eprintln!("[sidecar] failed to spawn: {e}"),
            }
        } else {
            eprintln!("[sidecar] sidecar directory not found, running without sidecar");
        }

        SidecarManager {
            child,
            stdin,
            next_id: Mutex::new(1),
        }
    }

    /// Send a request to the sidecar via stdin
    pub fn send_request(&self, method: &str, params: serde_json::Value) {
        let mut id_guard = self.next_id.lock().unwrap();
        let id = *id_guard;
        *id_guard += 1;
        drop(id_guard);

        let msg = serde_json::json!({ "id": id, "method": method, "params": params });
        if let Some(ref mut stdin) = *self.stdin.lock().unwrap() {
            let _ = writeln!(stdin, "{}", msg);
            let _ = stdin.flush();
        }
    }

    fn start_sidecar<R: Runtime>(
        dir: &PathBuf,
        child: &Arc<Mutex<Option<Child>>>,
        stdin_arc: &Arc<Mutex<Option<ChildStdin>>>,
        app: &AppHandle<R>,
    ) -> Result<(), String> {
        // Check if we have a bundled sidecar (release) or source (dev)
        let bundled_mjs = dir.join("index.mjs");
        let (cmd, args, work_dir): (String, Vec<String>, PathBuf) = if bundled_mjs.exists() {
            // Bundled: run with node
            let node = find_executable("node").ok_or("node not found in PATH")?;
            (node, vec!["index.mjs".to_string()], dir.clone())
        } else {
            // Dev: run with npx tsx
            let npx = find_executable("npx").ok_or("npx not found in PATH")?;
            (npx, vec!["tsx".to_string(), "src/index.ts".to_string()], dir.clone())
        };

        let mut proc = Command::new(&cmd)
            .args(&args)
            .current_dir(&work_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .env("PATH", enhanced_path())
            .spawn()
            .map_err(|e| format!("spawn failed: {e}"))?;

        let stdout = proc.stdout.take().ok_or("no stdout")?;
        let proc_stdin = proc.stdin.take();
        *stdin_arc.lock().unwrap() = proc_stdin;
        *child.lock().unwrap() = Some(proc);

        let app_handle = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                if line.is_empty() {
                    continue;
                }
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                    if let Some(event_name) = value.get("event").and_then(|v| v.as_str()) {
                        let data = value.get("data").cloned().unwrap_or(serde_json::Value::Null);

                        // Handle tauriCommand events locally (keyboard injection, app activation)
                        if event_name == "tauriCommand" {
                            handle_tauri_command(&data);
                        } else {
                            let _ = app_handle.emit(event_name, data);
                        }
                    }
                }
            }
        });

        Ok(())
    }

    #[allow(dead_code)]
    pub fn kill(&self) {
        if let Some(ref mut child) = *self.child.lock().unwrap() {
            let _ = child.kill();
        }
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        self.kill();
    }
}

/// Handle commands from the sidecar that need native execution
fn handle_tauri_command(data: &serde_json::Value) {
    let method = data.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let params = data.get("params").cloned().unwrap_or(serde_json::Value::Null);

    match method {
        "activate_app" => {
            if let Some(bundle_id) = params.get("bundleId").and_then(|v| v.as_str()) {
                crate::keyboard::activate_app(bundle_id);
            }
        }
        "send_goto_tab" => {
            if let Some(tab) = params.get("tab").and_then(|v| v.as_u64()) {
                crate::keyboard::send_goto_tab(tab as u16);
            }
        }
        "navigate_pane" => {
            let reset = params.get("resetCount").and_then(|v| v.as_u64()).unwrap_or(0) as u16;
            let forward = params.get("forwardCount").and_then(|v| v.as_u64()).unwrap_or(0) as u16;
            crate::keyboard::navigate_pane(reset, forward);
        }
        _ => {
            eprintln!("[sidecar] unknown tauriCommand: {method}");
        }
    }
}

/// Find the sidecar directory by checking multiple locations
fn find_sidecar_dir() -> Option<PathBuf> {
    // Check inside app bundle Resources first (release builds)
    if let Ok(exe) = std::env::current_exe() {
        let resources = exe
            .parent()? // MacOS/
            .parent()? // Contents/
            .join("Resources/sidecar");
        if resources.join("index.mjs").exists() {
            return Some(resources);
        }
    }

    // Dev mode: check relative to cwd
    let cwd = std::env::current_dir().ok()?;
    let candidates = [
        cwd.join("packages/sidecar"),            // from project root
        cwd.join("../../packages/sidecar"),       // from apps/desktop/
        cwd.join("../packages/sidecar"),          // from apps/
        // From the binary's location
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.join("../../../packages/sidecar")))
            .unwrap_or_default(),
    ];

    for c in &candidates {
        if c.join("src/index.ts").exists() {
            return Some(c.clone());
        }
    }

    None
}

/// Find an executable in PATH and common Node locations
fn find_executable(name: &str) -> Option<String> {
    // Try PATH first
    if let Ok(output) = Command::new("which").arg(name).output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }

    // Common Node.js locations on macOS
    let common_paths = [
        format!("/usr/local/bin/{name}"),
        format!("/opt/homebrew/bin/{name}"),
        format!(
            "{}/.nvm/versions/node/current/bin/{name}",
            std::env::var("HOME").unwrap_or_default()
        ),
    ];
    for p in &common_paths {
        if std::path::Path::new(p).exists() {
            return Some(p.clone());
        }
    }

    None
}

/// Build an enhanced PATH that includes common Node.js locations
fn enhanced_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_default();
    format!(
        "/usr/local/bin:/opt/homebrew/bin:{}/.nvm/versions/node/current/bin:{}",
        home, current
    )
}
