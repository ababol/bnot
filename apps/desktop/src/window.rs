use crate::notch::NotchGeometry;
use std::sync::atomic::{AtomicU8, Ordering};
use tauri::{AppHandle, Emitter, Runtime, WebviewWindow};

const COMPACT_SIDE_EXTENSION: f64 = 68.0;
const ANIMATION_DURATION: f64 = 0.2;
const WINDOW_LEVEL_ABOVE_STATUS: i64 = 26; // CGWindowLevelForKey(.statusWindow) + 1

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum PanelState {
    Compact = 0,
    Alert = 1,
    Overview = 2,
    Approval = 3,
    Ask = 4,
}

impl PanelState {
    pub fn parse(s: &str) -> Self {
        match s {
            "alert" => Self::Alert,
            "overview" => Self::Overview,
            "approval" => Self::Approval,
            "ask" => Self::Ask,
            _ => Self::Compact,
        }
    }

    fn from_raw(raw: u8) -> Self {
        match raw {
            1 => Self::Alert,
            2 => Self::Overview,
            3 => Self::Approval,
            4 => Self::Ask,
            _ => Self::Compact,
        }
    }
}

static CURRENT_PANEL_STATE: AtomicU8 = AtomicU8::new(PanelState::Compact as u8);

/// Record the panel state so the hover watcher can pick bounds that match
/// what's on screen. Without this, shorter panels (overview) leave a phantom
/// band below them where cursor-exit never fires.
pub fn set_current_panel_state(state: PanelState) {
    CURRENT_PANEL_STATE.store(state as u8, Ordering::Relaxed);
}

/// Compact frame: returns (x, width, height) in logical points.
pub fn compact_frame(geom: &NotchGeometry) -> (f64, f64, f64) {
    let w = geom.notch_width + COMPACT_SIDE_EXTENSION * 2.0;
    let h = geom.notch_height;
    let x = geom.center_x - w / 2.0;
    (x, w, h)
}

/// Expanded frame for a given panel state: returns (x, y, width, height) in logical points.
pub fn expanded_frame(state: PanelState, geom: &NotchGeometry) -> (f64, f64, f64, f64) {
    let (w, h) = match state {
        PanelState::Compact => {
            let (x, w, h) = compact_frame(geom);
            return (x, 0.0, w, h);
        }
        PanelState::Alert => {
            // Wider compact to fit bell + session count
            let w = geom.notch_width + COMPACT_SIDE_EXTENSION * 2.0 + 30.0;
            let h = geom.notch_height;
            let x = geom.center_x - w / 2.0;
            return (x, 0.0, w, h);
        }
        PanelState::Overview => (geom.notch_width + 380.0, 300.0),
        PanelState::Approval | PanelState::Ask => (geom.notch_width + 380.0, 520.0),
    };

    let x = geom.center_x - w / 2.0;
    (x, 0.0, w, h)
}

#[cfg(target_os = "macos")]
fn get_ns_window<R: Runtime>(window: &WebviewWindow<R>) -> Option<objc2::rc::Retained<objc2::runtime::AnyObject>> {
    let raw = window.ns_window().ok()? as *mut objc2::runtime::AnyObject;
    unsafe { objc2::rc::Retained::retain(raw) }
}

/// Animate the window frame transition using NSAnimationContext.
pub fn animate_frame<R: Runtime>(window: &WebviewWindow<R>, x: f64, y: f64, w: f64, h: f64) {
    #[cfg(target_os = "macos")]
    {
        use objc2::rc::Retained;
        use objc2::runtime::AnyObject;
        use objc2_foundation::{NSPoint, NSRect, NSSize};

        let Some(ns_window) = get_ns_window(window) else {
            return;
        };

        unsafe {
            // Get screen height for coordinate flipping (NSWindow = bottom-left origin)
            let screen: Retained<AnyObject> = objc2::msg_send_id![&ns_window, screen];
            let screen_frame: NSRect = objc2::msg_send![&*screen, frame];
            let ns_y = screen_frame.size.height - y - h;

            let target = NSRect {
                origin: NSPoint { x, y: ns_y },
                size: NSSize { width: w, height: h },
            };

            // Begin animation group
            let _: () =
                objc2::msg_send![objc2::class!(NSAnimationContext), beginGrouping];

            let ctx: Retained<AnyObject> =
                objc2::msg_send_id![objc2::class!(NSAnimationContext), currentContext];
            let _: () = objc2::msg_send![&*ctx, setDuration: ANIMATION_DURATION];

            let timing_name = objc2_foundation::NSString::from_str("easeOut");
            let timing: Retained<AnyObject> = objc2::msg_send_id![
                objc2::class!(CAMediaTimingFunction),
                functionWithName: &*timing_name
            ];
            let _: () = objc2::msg_send![&*ctx, setTimingFunction: &*timing];

            // Animate via the window's animator proxy
            let animator: Retained<AnyObject> = objc2::msg_send_id![&ns_window, animator];
            let _: () = objc2::msg_send![&*animator, setFrame: target display: true];

            let _: () =
                objc2::msg_send![objc2::class!(NSAnimationContext), endGrouping];
        }
    }
}

/// Poll the global cursor position on a background thread and emit `notch-hover`
/// events. Tracks two zones:
///   - `trigger`: the compact notch frame (opens overview on enter)
///   - `zone`: the full expanded frame (closes overview on leave)
/// Polling natively means we don't depend on DOM mouseenter/mouseleave, which
/// only fire reliably when the WKWebView is in the key window.
pub fn start_hover_watcher<R: Runtime>(app: AppHandle<R>) {
    use core_graphics::event::CGEvent;
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    let in_trigger = Arc::new(AtomicBool::new(false));
    let in_zone = Arc::new(AtomicBool::new(false));

    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(80));

        let Some(geom) = crate::notch::get_notch_geometry() else { continue };
        let (cx, cw, ch) = compact_frame(&geom);
        // In expanded states the zone must match the rendered panel, or a
        // phantom band below shorter panels (overview) keeps them stuck open.
        // In collapsed states the panel is closed, so widen the zone to the
        // tallest expanded variant (approval) — cursor movements near the
        // notch then emit trigger=false events that prime compact-view's
        // `sawExit` guard, which gates the first hover-to-open.
        let current = PanelState::from_raw(CURRENT_PANEL_STATE.load(Ordering::Relaxed));
        let zone_state = match current {
            PanelState::Compact | PanelState::Alert => PanelState::Approval,
            other => other,
        };
        let (ex, _, ew, eh) = expanded_frame(zone_state, &geom);

        let Ok(source) = CGEventSource::new(CGEventSourceStateID::HIDSystemState) else { continue };
        let Ok(event) = CGEvent::new(source) else { continue };
        let loc = event.location();

        // CGEvent.location and Tauri logical coords share a top-left origin.
        let now_trigger = loc.x >= cx && loc.x <= cx + cw && loc.y >= 0.0 && loc.y <= ch;
        let now_zone = loc.x >= ex && loc.x <= ex + ew && loc.y >= 0.0 && loc.y <= eh;

        let was_trigger = in_trigger.swap(now_trigger, Ordering::Relaxed);
        let was_zone = in_zone.swap(now_zone, Ordering::Relaxed);

        if now_trigger != was_trigger || now_zone != was_zone {
            let _ = app.emit(
                "notch-hover",
                serde_json::json!({ "trigger": now_trigger, "zone": now_zone }),
            );
        }
    });
}

/// Make the window key so it can receive/lose focus events.
/// Called when the panel expands so that clicking outside triggers a blur event,
/// which the frontend uses to collapse back to compact.
pub fn make_key_window<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        let Some(ns_window) = get_ns_window(window) else {
            return;
        };
        unsafe {
            // Re-swizzle: the webview loads async, so subviews that existed at
            // setup time aren't the full hierarchy. Doing it here catches any
            // later-spawned WebKit view classes so the first click lands.
            swizzle_accepts_first_mouse(&ns_window);
            let _: () = objc2::msg_send![&ns_window, makeKeyWindow];
        }
    }
}

/// Show the window without activating the application or making it key.
/// Use instead of `win.show()` (which calls `makeKeyAndOrderFront:`) so that
/// Bnot never steals focus — critical when launched from Finder where
/// the app briefly becomes frontmost before the Accessory policy takes effect.
pub fn show_without_activation<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        let Some(ns_window) = get_ns_window(window) else {
            return;
        };
        unsafe {
            let _: () = objc2::msg_send![&ns_window, orderFrontRegardless];
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.show();
    }
}

/// Apply macOS-specific window properties that Tauri config cannot express.
pub fn configure_macos_window<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        use objc2::MainThreadMarker;
        use objc2_app_kit::{
            NSApplication, NSApplicationActivationPolicy, NSWindowCollectionBehavior,
        };

        let Some(ns_window) = get_ns_window(window) else {
            eprintln!("[window] ns_window pointer was null");
            return;
        };

        unsafe {
            let _: () = objc2::msg_send![&ns_window, setLevel: WINDOW_LEVEL_ABOVE_STATUS];

            // Collection behavior
            let behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::IgnoresCycle;
            let _: () = objc2::msg_send![&ns_window, setCollectionBehavior: behavior];

            // Don't hide when app deactivates
            let _: () = objc2::msg_send![&ns_window, setHidesOnDeactivate: false];

            // Make clicks pass through without requiring focus first.
            // Swizzle acceptsFirstMouse: on the window's content view to return YES.
            swizzle_accepts_first_mouse(&ns_window);

            // Hide from Dock
            let mtm = MainThreadMarker::new_unchecked();
            let app = NSApplication::sharedApplication(mtm);
            app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
        }
    }
}

/// Swizzle `acceptsFirstMouse:` on WKWebView and its internal view classes so that
/// clicks register immediately without requiring the window to be focused first.
/// First seeds the known public WebKit classes, then walks the live view hierarchy
/// and swizzles whatever private subview classes the current macOS build is using —
/// those names differ between OS releases, so a hard-coded list misses clicks and
/// forces users to click twice (once to focus, once to hit the control).
#[cfg(target_os = "macos")]
unsafe fn swizzle_accepts_first_mouse(ns_window: &objc2::rc::Retained<objc2::runtime::AnyObject>) {
    use objc2::runtime::{AnyClass, Sel};

    let _: () = objc2::msg_send![&**ns_window, setIgnoresMouseEvents: false];

    let sel = Sel::register(c"acceptsFirstMouse:");

    for class_name in [c"WKWebView", c"WKScrollView", c"WKContentView", c"WKFlippedView"] {
        if let Some(cls) = AnyClass::get(class_name) {
            install_yes_accepts_first_mouse(cls, sel);
        }
    }

    let content_view: *mut objc2::runtime::AnyObject =
        objc2::msg_send![&**ns_window, contentView];
    if !content_view.is_null() {
        swizzle_view_tree(&*content_view, sel);
    }
}

#[cfg(target_os = "macos")]
unsafe fn install_yes_accepts_first_mouse(cls: &objc2::runtime::AnyClass, sel: objc2::runtime::Sel) {
    use objc2::runtime::{Bool, Sel};

    extern "C" fn yes_accepts_first_mouse(
        _this: &objc2::runtime::AnyObject,
        _sel: Sel,
        _event: *mut objc2::runtime::AnyObject,
    ) -> Bool {
        Bool::YES
    }

    let added = class_addMethod(
        cls as *const _ as *mut _,
        sel,
        yes_accepts_first_mouse as *const std::ffi::c_void,
        "B@:@\0".as_ptr() as *const i8,
    );
    if !added {
        class_replaceMethod(
            cls as *const _ as *mut _,
            sel,
            yes_accepts_first_mouse as *const std::ffi::c_void,
            "B@:@\0".as_ptr() as *const i8,
        );
    }
}

#[cfg(target_os = "macos")]
unsafe fn swizzle_view_tree(view: &objc2::runtime::AnyObject, sel: objc2::runtime::Sel) {
    let cls_ptr: *const objc2::runtime::AnyClass = objc2::msg_send![view, class];
    if !cls_ptr.is_null() {
        install_yes_accepts_first_mouse(&*cls_ptr, sel);
    }

    let subviews: *mut objc2::runtime::AnyObject = objc2::msg_send![view, subviews];
    if subviews.is_null() {
        return;
    }
    let count: usize = objc2::msg_send![subviews, count];
    for i in 0..count {
        let subview: *mut objc2::runtime::AnyObject =
            objc2::msg_send![subviews, objectAtIndex: i];
        if !subview.is_null() {
            swizzle_view_tree(&*subview, sel);
        }
    }
}

// FFI declarations for Objective-C runtime functions
#[cfg(target_os = "macos")]
extern "C" {
    fn class_addMethod(
        cls: *mut objc2::runtime::AnyClass,
        sel: objc2::runtime::Sel,
        imp: *const std::ffi::c_void,
        types: *const i8,
    ) -> bool;

    fn class_replaceMethod(
        cls: *mut objc2::runtime::AnyClass,
        sel: objc2::runtime::Sel,
        imp: *const std::ffi::c_void,
        types: *const i8,
    ) -> *const std::ffi::c_void;
}
