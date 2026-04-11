use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Manager, Runtime,
};

pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) {
    let quit = MenuItemBuilder::with_id("quit", "Quit BuddyNotch").build(app).unwrap();
    let show = MenuItemBuilder::with_id("show", "Show Panel").build(app).unwrap();
    let settings = MenuItemBuilder::with_id("settings", "Settings...").build(app).unwrap();
    let userscript =
        MenuItemBuilder::with_id("install_userscript", "Install Userscript...").build(app).unwrap();

    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&userscript)
        .item(&settings)
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
            "install_userscript" => {
                // Find the userscript: bundled in Resources (release) or source (dev)
                let userscript_path = find_userscript();
                if let Some(path) = userscript_path {
                    // Opening a .user.js in the browser triggers Tampermonkey's install prompt
                    let _ = std::process::Command::new("open").arg(&path).spawn();
                } else {
                    eprintln!("[tray] userscript not found");
                }
            }
            "settings" => {
                let home = std::env::var("HOME").unwrap_or_default();
                let config_path = format!("{home}/.buddy-notch/config.json");
                let _ = std::process::Command::new("open")
                    .arg("-e")
                    .arg(&config_path)
                    .spawn();
            }
            _ => {}
        })
        .build(app)
        .unwrap();
}

/// Find the bundled userscript (release: in Resources, dev: in source tree)
fn find_userscript() -> Option<String> {
    // Release: inside app bundle Resources/
    if let Ok(exe) = std::env::current_exe() {
        if let Some(resources) = exe.parent().and_then(|p| p.parent()) {
            let bundled = resources.join("Resources/userscript/buddynotch-worktree.user.js");
            if bundled.exists() {
                return Some(bundled.to_string_lossy().into_owned());
            }
        }
    }

    // Dev: relative to cwd
    let cwd = std::env::current_dir().ok()?;
    let candidates = [
        cwd.join("packages/userscript/buddynotch-worktree.user.js"),
        cwd.join("../../packages/userscript/buddynotch-worktree.user.js"),
    ];
    for c in &candidates {
        if c.exists() {
            return Some(c.to_string_lossy().into_owned());
        }
    }

    None
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
