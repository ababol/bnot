mod commands;
mod keyboard;
mod notch;
mod sidecar;
mod tray;
mod window;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::get_notch_geometry,
            commands::set_panel_state,
            commands::send_goto_tab,
            commands::navigate_pane,
            commands::activate_app,
            commands::jump_to_session,
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

            // System tray
            tray::setup_tray(&app.handle().clone());

            // Spawn the Node.js sidecar (non-fatal if it fails)
            let handle = app.handle().clone();
            let _sidecar = sidecar::SidecarManager::spawn(&handle);
            app.manage(_sidecar);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
