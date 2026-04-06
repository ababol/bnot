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

            window::configure_macos_window(&win);

            // Position at notch using logical coordinates
            if let Some(geom) = notch::get_notch_geometry() {
                let (x, w, h) = window::compact_frame(&geom);
                let _ = win.set_position(tauri::LogicalPosition::new(x, 0.0));
                let _ = win.set_size(tauri::LogicalSize::new(w, h));
            } else {
                let _ = win.set_position(tauri::LogicalPosition::new(500.0, 0.0));
                let _ = win.set_size(tauri::LogicalSize::new(300.0, 32.0));
            }

            let _ = win.show();

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
