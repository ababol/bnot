use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Manager, Runtime,
};

pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) {
    let quit = MenuItemBuilder::with_id("quit", "Quit BuddyNotch").build(app).unwrap();
    let show = MenuItemBuilder::with_id("show", "Show Panel").build(app).unwrap();

    let menu = MenuBuilder::new(app)
        .item(&show)
        .separator()
        .item(&quit)
        .build()
        .unwrap();

    // 16x16 green pixel icon
    let icon_data = create_tray_icon();
    let icon = Image::new(&icon_data, 16, 16);

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "quit" => {
                app.exit(0);
            }
            "show" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                }
            }
            _ => {}
        })
        .build(app)
        .unwrap();
}

/// Create a simple 16x16 RGBA icon (green square)
fn create_tray_icon() -> Vec<u8> {
    let mut data = vec![0u8; 16 * 16 * 4];
    for y in 0..16 {
        for x in 0..16 {
            let idx = (y * 16 + x) * 4;
            // Simple buddy-like shape
            let in_body = x >= 3 && x <= 12 && y >= 4 && y <= 11;
            let in_ear = (x >= 3 && x <= 5 && y >= 2 && y <= 3)
                || (x >= 10 && x <= 12 && y >= 2 && y <= 3);
            let in_foot = (x >= 3 && x <= 6 && y >= 12 && y <= 13)
                || (x >= 9 && x <= 12 && y >= 12 && y <= 13);
            let is_eye = (x >= 5 && x <= 6 && y >= 6 && y <= 7)
                || (x >= 9 && x <= 10 && y >= 6 && y <= 7);

            if is_eye {
                data[idx] = 0;     // R
                data[idx + 1] = 0; // G
                data[idx + 2] = 0; // B
                data[idx + 3] = 255; // A
            } else if in_body || in_ear || in_foot {
                data[idx] = 74;    // R
                data[idx + 1] = 222; // G
                data[idx + 2] = 128; // B
                data[idx + 3] = 255; // A
            }
        }
    }
    data
}
