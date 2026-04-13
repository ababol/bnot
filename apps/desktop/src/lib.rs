mod commands;
mod keyboard;
mod notch;
mod sidecar;
mod window;

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_notch_geometry,
            commands::set_panel_state,
            commands::jump_to_session,
            commands::answer_question,
            commands::approve_session,
            commands::approve_session_always,
            commands::deny_session,
            commands::accept_edits_session,
            commands::bypass_permissions_session,
            commands::resume_session,
            commands::open_settings,
            commands::quit_app,
            commands::get_hook_health,
            commands::repair_hooks,
        ])
        .setup(|app| {
            let win = app.get_webview_window("main").expect("main window");

            // Read notch geometry BEFORE setting Accessory policy,
            // as macOS may not report auxiliaryTopLeftArea for accessory apps.
            let geom = notch::get_notch_geometry();
            eprintln!("[setup] notch geometry: {:?}", geom);

            window::configure_macos_window(&win);

            // Position at notch using logical coordinates
            if let Some(ref geom) = geom {
                let (x, w, h) = window::compact_frame(geom);
                eprintln!("[setup] positioning at x={}, w={}, h={}", x, w, h);
                let _ = win.set_position(tauri::LogicalPosition::new(x, 0.0));
                let _ = win.set_size(tauri::LogicalSize::new(w, h));
            } else {
                eprintln!("[setup] no notch detected, using fallback position");
                let _ = win.set_position(tauri::LogicalPosition::new(500.0, 0.0));
                let _ = win.set_size(tauri::LogicalSize::new(300.0, 32.0));
            }

            window::show_without_activation(&win);

            // Detect cursor hover over the notch even when unfocused
            window::start_hover_watcher(app.handle().clone());

            // Spawn the Node.js sidecar (non-fatal if it fails)
            let handle = app.handle().clone();
            let _sidecar = sidecar::SidecarManager::spawn(&handle);
            app.manage(_sidecar);

            // Handle deep link URLs (bnot://worktree?...)
            let dl_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url_obj in event.urls() {
                    let url_str = url_obj.as_str();
                    eprintln!("[deep-link] received: {url_str}");
                    if let Ok(parsed) = url::Url::parse(url_str) {
                        if parsed.host_str() == Some("worktree") {
                            let params: serde_json::Value = parsed
                                .query_pairs()
                                .map(|(k, v)| (k.to_string(), serde_json::Value::String(v.to_string())))
                                .collect::<serde_json::Map<String, serde_json::Value>>()
                                .into();
                            let sidecar = dl_handle.state::<crate::sidecar::SidecarManager>();
                            sidecar.send_request("openWorktree", params);
                        }
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
