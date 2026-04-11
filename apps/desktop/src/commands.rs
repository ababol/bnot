use crate::keyboard;
use crate::notch::{self, NotchGeometry};
use crate::window;
use tauri::{command, AppHandle, Manager, Runtime};

#[command]
pub fn get_notch_geometry() -> Option<NotchGeometry> {
    notch::get_notch_geometry()
}

#[command]
pub fn set_panel_state<R: Runtime>(app: AppHandle<R>, state: String) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or("Window not found")?;

    let geom = notch::get_notch_geometry().ok_or("No notch detected")?;
    let (x, y, w, h) = window::expanded_frame(&state, &geom);

    // Use animated transition instead of instant set_position/set_size
    window::animate_frame(&win, x, y, w, h);
    window::show_without_activation(&win);

    // Make the window key when expanding so that clicking outside triggers
    // a blur event, allowing the frontend to collapse back to compact.
    if state != "compact" {
        window::make_key_window(&win);
    }

    Ok(())
}

#[command]
pub fn send_goto_tab(tab: u16) {
    keyboard::send_goto_tab(tab);
}

#[command]
pub fn navigate_pane(reset_count: u16, forward_count: u16) {
    keyboard::navigate_pane(reset_count, forward_count);
}

#[command]
pub fn activate_app(bundle_id: String) -> bool {
    keyboard::activate_app(&bundle_id)
}

#[command]
pub fn jump_to_session<R: Runtime>(app: AppHandle<R>, session_id: String) {
    let sidecar = app.state::<crate::sidecar::SidecarManager>();
    sidecar.send_request(
        "jumpToSession",
        serde_json::json!({ "sessionId": session_id }),
    );
}

#[command]
pub fn approve_session<R: Runtime>(app: AppHandle<R>, session_id: String) {
    let sidecar = app.state::<crate::sidecar::SidecarManager>();
    sidecar.send_request(
        "approveSession",
        serde_json::json!({ "sessionId": session_id }),
    );
}

#[command]
pub fn deny_session<R: Runtime>(app: AppHandle<R>, session_id: String) {
    let sidecar = app.state::<crate::sidecar::SidecarManager>();
    sidecar.send_request(
        "denySession",
        serde_json::json!({ "sessionId": session_id }),
    );
}
