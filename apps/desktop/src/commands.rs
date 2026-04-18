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
    let panel = window::PanelState::parse(&state);
    let (x, y, w, h) = window::expanded_frame(panel, &geom);

    // Tell the hover watcher about the new state before animating, so its
    // zone bounds match the state the window is transitioning into.
    window::set_current_panel_state(panel);

    // Use animated transition instead of instant set_position/set_size
    window::animate_frame(&win, x, y, w, h);
    window::show_without_activation(&win);

    // Make the window key when expanding so that clicking outside triggers
    // a blur event, allowing the frontend to collapse back to compact.
    if panel != window::PanelState::Compact {
        window::make_key_window(&win);
    }

    Ok(())
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
pub fn answer_question<R: Runtime>(app: AppHandle<R>, session_id: String, answers: serde_json::Value) {
    let sidecar = app.state::<crate::sidecar::SidecarManager>();
    sidecar.send_request(
        "answerQuestion",
        serde_json::json!({ "sessionId": session_id, "answers": answers }),
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
pub fn deny_session<R: Runtime>(app: AppHandle<R>, session_id: String, feedback: Option<String>) {
    let sidecar = app.state::<crate::sidecar::SidecarManager>();
    let mut params = serde_json::json!({ "sessionId": session_id });
    if let Some(fb) = feedback {
        params["feedback"] = serde_json::Value::String(fb);
    }
    sidecar.send_request("denySession", params);
}

#[command]
pub fn accept_edits_session<R: Runtime>(app: AppHandle<R>, session_id: String) {
    let sidecar = app.state::<crate::sidecar::SidecarManager>();
    sidecar.send_request(
        "acceptEditsSession",
        serde_json::json!({ "sessionId": session_id }),
    );
}

#[command]
pub fn bypass_permissions_session<R: Runtime>(app: AppHandle<R>, session_id: String) {
    let sidecar = app.state::<crate::sidecar::SidecarManager>();
    sidecar.send_request(
        "bypassPermissionsSession",
        serde_json::json!({ "sessionId": session_id }),
    );
}

#[command]
pub fn approve_session_always<R: Runtime>(app: AppHandle<R>, session_id: String) {
    let sidecar = app.state::<crate::sidecar::SidecarManager>();
    sidecar.send_request(
        "approveSessionAlways",
        serde_json::json!({ "sessionId": session_id }),
    );
}

#[command]
pub fn resume_session<R: Runtime>(app: AppHandle<R>, session_id: String, project_path: String) {
    let sidecar = app.state::<crate::sidecar::SidecarManager>();
    sidecar.send_request(
        "resumeSession",
        serde_json::json!({ "sessionId": session_id, "projectPath": project_path }),
    );
}

#[command]
pub fn open_worktree_path<R: Runtime>(app: AppHandle<R>, path: String) {
    let sidecar = app.state::<crate::sidecar::SidecarManager>();
    sidecar.send_request(
        "openWorktreePath",
        serde_json::json!({ "path": path }),
    );
}

#[command]
pub fn open_settings() {
    let home = std::env::var("HOME").unwrap_or_default();
    let config_path = format!("{home}/.bnot/config.json");
    let _ = std::process::Command::new("open").arg("-e").arg(&config_path).spawn();
}

#[command]
pub fn quit_app<R: Runtime>(app: AppHandle<R>) {
    app.exit(0);
}

#[command]
pub fn get_hook_health<R: Runtime>(app: AppHandle<R>) {
    let sidecar = app.state::<crate::sidecar::SidecarManager>();
    sidecar.send_request("getHookHealth", serde_json::json!({}));
}

#[command]
pub fn repair_hooks<R: Runtime>(app: AppHandle<R>) {
    let sidecar = app.state::<crate::sidecar::SidecarManager>();
    sidecar.send_request("repairHooks", serde_json::json!({}));
}
