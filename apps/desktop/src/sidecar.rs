use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::socket_server::SocketServerHandle;

pub struct SidecarManager {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    next_id: Mutex<u64>,
}

impl SidecarManager {
    pub fn spawn<R: Runtime>(app: &AppHandle<R>) -> Self {
        // Kill any leftover sidecar from a previous run
        kill_stale_sidecar();

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
        } else {
            eprintln!("[sidecar] dropping {method} — sidecar stdin not ready");
        }
    }

    fn start_sidecar<R: Runtime>(
        dir: &std::path::Path,
        child: &Arc<Mutex<Option<Child>>>,
        stdin_arc: &Arc<Mutex<Option<ChildStdin>>>,
        app: &AppHandle<R>,
    ) -> Result<(), String> {
        // Check if we have a bundled sidecar (release) or source (dev)
        let bundled_mjs = dir.join("index.mjs");
        let (cmd, args, work_dir): (String, Vec<String>, PathBuf) = if bundled_mjs.exists() {
            // Bundled: run with node
            let node = find_executable("node").ok_or("node not found in PATH")?;
            (node, vec!["index.mjs".to_string()], dir.to_path_buf())
        } else {
            // Dev: run with npx tsx
            let npx = find_executable("npx").ok_or("npx not found in PATH")?;
            (npx, vec!["tsx".to_string(), "src/index.ts".to_string()], dir.to_path_buf())
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
                        match event_name {
                            "tauriCommand" => handle_tauri_command(&data),
                            "socketResponse" => handle_socket_response(&app_handle, &data),
                            "socketDisconnect" => handle_socket_disconnect(&app_handle, &data),
                            _ => {
                                let _ = app_handle.emit(event_name, data);
                            }
                        }
                    }
                }
            }
        });

        Ok(())
    }

    pub fn kill(&self) {
        if let Some(ref mut child) = *self.child.lock().unwrap() {
            // Send SIGTERM so the sidecar can clean up (PID file, socket)
            let _ = Command::new("kill")
                .args(["-s", "TERM", &child.id().to_string()])
                .output();
            // Give it a moment to shut down, then force kill
            std::thread::sleep(std::time::Duration::from_millis(200));
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        self.kill();
    }
}

/// No-ops if the client has already disconnected.
fn handle_socket_response<R: Runtime>(app: &AppHandle<R>, data: &serde_json::Value) {
    let Some(client_id) = data.get("clientId").and_then(|v| v.as_u64()) else {
        return;
    };
    let Some(response) = data.get("response") else {
        return;
    };
    let Ok(line) = serde_json::to_string(response) else {
        return;
    };
    if let Some(handle) = app.try_state::<SocketServerHandle>() {
        handle.send_response(client_id, line);
    }
}

fn handle_socket_disconnect<R: Runtime>(app: &AppHandle<R>, data: &serde_json::Value) {
    let Some(client_id) = data.get("clientId").and_then(|v| v.as_u64()) else {
        return;
    };
    if let Some(handle) = app.try_state::<SocketServerHandle>() {
        handle.close(client_id);
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

/// Kill any leftover sidecar and bridge processes from previous runs.
/// Uses the PID file for the sidecar and a process scan to catch orphans.
/// Also kills any running bnot-bridge processes — at this point a new sidecar
/// hasn't started yet, so any live bridge is talking to the old (dead) sidecar
/// and will just sit in its approval timeout.
fn kill_stale_sidecar() {
    let home = std::env::var("HOME").unwrap_or_default();
    let pid_path = format!("{home}/.bnot/bnot.pid");
    let mut killed = false;

    // 1. Kill the sidecar recorded in the PID file
    if let Ok(pid_str) = std::fs::read_to_string(&pid_path) {
        if let Ok(pid) = pid_str.trim().parse::<i32>() {
            let alive = Command::new("kill")
                .args(["-0", &pid.to_string()])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            if alive {
                eprintln!("[sidecar] killing stale sidecar (pid {pid})");
                let _ = Command::new("kill").args([&pid.to_string()]).output();
                killed = true;
            }
        }
        let _ = std::fs::remove_file(&pid_path);
    }

    // 2. Scan for orphaned sidecar processes and any running bnot-bridge.
    // Sidecar runs as `node … index.mjs` (release) or `node … src/index.ts` /
    // `tsx … src/index.ts` (dev). Bridge runs as `…/bnot-bridge <subcommand>`.
    if let Ok(output) = Command::new("/bin/ps")
        .args(["-eo", "pid,ppid,args"])
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let cols: Vec<&str> = line.trim().splitn(3, char::is_whitespace).collect();
            if cols.len() < 3 {
                continue;
            }
            let Ok(pid) = cols[0].parse::<i32>() else { continue };
            let ppid = cols[1].trim();
            let args = cols[2];

            let is_orphan_sidecar = ppid == "1"
                && (args.contains("index.mjs")
                    || (args.contains("src/index.ts") && args.contains("sidecar")));
            // Only match processes whose executable is literally bnot-bridge,
            // not anything that merely mentions it in argv (e.g. the pnpm/sh
            // wrapper running `cargo build -p bnot-bridge && tauri dev`).
            let argv0 = args.split_ascii_whitespace().next().unwrap_or("");
            let is_bridge = argv0.ends_with("/bnot-bridge") || argv0 == "bnot-bridge";

            if is_orphan_sidecar {
                eprintln!("[sidecar] killing orphaned sidecar (pid {pid})");
                let _ = Command::new("kill").args([&pid.to_string()]).output();
                killed = true;
            } else if is_bridge {
                eprintln!("[sidecar] killing stale bridge (pid {pid})");
                let _ = Command::new("kill").args([&pid.to_string()]).output();
                killed = true;
            }
        }
    }

    if killed {
        std::thread::sleep(std::time::Duration::from_millis(300));
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

    let home = std::env::var("HOME").unwrap_or_default();

    // Common fixed locations
    let fixed = [
        format!("/usr/local/bin/{name}"),
        format!("/opt/homebrew/bin/{name}"),
        format!("/opt/homebrew/opt/node/bin/{name}"),
        format!("{home}/.volta/bin/{name}"),
        format!("{home}/.nvm/versions/node/current/bin/{name}"),
    ];
    for p in &fixed {
        if std::path::Path::new(p).exists() {
            return Some(p.clone());
        }
    }

    // NVM: scan all version directories, pick the newest by numeric version.
    // String sort is wrong here: "v8" > "v24" lexicographically.
    let nvm_dir = format!("{home}/.nvm/versions/node");
    if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
        let mut versions: Vec<_> = entries.filter_map(|e| e.ok()).collect();
        let parse_ver = |name: std::ffi::OsString| -> (u32, u32, u32) {
            let s = name.to_string_lossy().into_owned();
            let s = s.trim_start_matches('v').to_string();
            let parts: Vec<u32> = s.split('.').filter_map(|p| p.parse().ok()).collect();
            (
                parts.first().copied().unwrap_or(0),
                parts.get(1).copied().unwrap_or(0),
                parts.get(2).copied().unwrap_or(0),
            )
        };
        versions.sort_by_key(|e| std::cmp::Reverse(parse_ver(e.file_name())));
        for entry in versions {
            let candidate = entry.path().join("bin").join(name);
            if candidate.exists() {
                return Some(candidate.to_string_lossy().into_owned());
            }
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
