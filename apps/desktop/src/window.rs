use crate::notch::NotchGeometry;
use tauri::{Runtime, WebviewWindow};

/// Compact frame: returns (x, width, height) in logical points.
pub fn compact_frame(geom: &NotchGeometry) -> (f64, f64, f64) {
    let side_ext = 36.0;
    let w = geom.notch_width + side_ext * 2.0;
    let h = geom.notch_height;
    let x = geom.center_x - w / 2.0;
    (x, w, h)
}

/// Expanded frame for a given panel state: returns (x, y, width, height) in logical points.
pub fn expanded_frame(state: &str, geom: &NotchGeometry) -> (f64, f64, f64, f64) {
    let (w, h) = match state {
        "compact" | "jump" => {
            let (x, w, h) = compact_frame(geom);
            return (x, 0.0, w, h);
        }
        "overview" => (geom.notch_width + 220.0, 360.0),
        "approval" => (geom.notch_width + 220.0, 420.0),
        "ask" => (geom.notch_width + 220.0, 340.0),
        _ => {
            let (x, w, h) = compact_frame(geom);
            return (x, 0.0, w, h);
        }
    };

    let x = geom.center_x - w / 2.0;
    (x, 0.0, w, h)
}

/// Animate the window frame transition using NSAnimationContext.
pub fn animate_frame<R: Runtime>(window: &WebviewWindow<R>, x: f64, y: f64, w: f64, h: f64) {
    #[cfg(target_os = "macos")]
    {
        use objc2::rc::Retained;
        use objc2::runtime::AnyObject;
        use objc2_foundation::{NSPoint, NSRect, NSSize};

        let raw = match window.ns_window() {
            Ok(ptr) => ptr as *mut AnyObject,
            Err(_) => return,
        };
        let Some(ns_window) = (unsafe { Retained::retain(raw) }) else {
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
            let _: () = objc2::msg_send![&*ctx, setDuration: 0.2f64];

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

/// Make the window key so it can receive/lose focus events.
/// Called when the panel expands so that clicking outside triggers a blur event,
/// which the frontend uses to collapse back to compact.
pub fn make_key_window<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        use objc2::rc::Retained;
        use objc2::runtime::AnyObject;

        let raw = match window.ns_window() {
            Ok(ptr) => ptr as *mut AnyObject,
            Err(_) => return,
        };
        let Some(ns_window) = (unsafe { Retained::retain(raw) }) else {
            return;
        };
        unsafe {
            let _: () = objc2::msg_send![&ns_window, makeKeyWindow];
        }
    }
}

/// Show the window without activating the application or making it key.
/// Use instead of `win.show()` (which calls `makeKeyAndOrderFront:`) so that
/// BuddyNotch never steals focus — critical when launched from Finder where
/// the app briefly becomes frontmost before the Accessory policy takes effect.
pub fn show_without_activation<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        use objc2::rc::Retained;
        use objc2::runtime::AnyObject;

        let raw = match window.ns_window() {
            Ok(ptr) => ptr as *mut AnyObject,
            Err(_) => return,
        };
        let Some(ns_window) = (unsafe { Retained::retain(raw) }) else {
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
        use objc2::rc::Retained;
        use objc2::runtime::{AnyClass, AnyObject, Bool, Sel};
        use objc2::MainThreadMarker;
        use objc2_app_kit::{
            NSApplication, NSApplicationActivationPolicy, NSWindowCollectionBehavior,
        };

        let raw = match window.ns_window() {
            Ok(ptr) => ptr as *mut AnyObject,
            Err(e) => {
                eprintln!("[window] Failed to get ns_window: {e}");
                return;
            }
        };

        let Some(ns_window) = (unsafe { Retained::retain(raw) }) else {
            eprintln!("[window] ns_window pointer was null");
            return;
        };

        unsafe {
            // Window level: above status window (CGWindowLevelForKey(.statusWindow) = 25)
            let level: i64 = 25 + 1;
            let _: () = objc2::msg_send![&ns_window, setLevel: level];

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
/// Targets classes by name rather than walking the live view hierarchy, so it works
/// regardless of when the WKWebView finishes loading (fixes production .app builds).
#[cfg(target_os = "macos")]
unsafe fn swizzle_accepts_first_mouse(ns_window: &objc2::rc::Retained<objc2::runtime::AnyObject>) {
    use objc2::runtime::{AnyClass, Bool, Sel};

    // Explicitly disable mouse-event pass-through on the window itself.
    let _: () = objc2::msg_send![&**ns_window, setIgnoresMouseEvents: false];

    let sel = Sel::register(c"acceptsFirstMouse:");

    extern "C" fn yes_accepts_first_mouse(
        _this: &objc2::runtime::AnyObject,
        _sel: Sel,
        _event: *mut objc2::runtime::AnyObject,
    ) -> Bool {
        Bool::YES
    }

    // Target WKWebView and its internal event-handling views by class name.
    // This approach works even before the webview has loaded its content, so it
    // is safe to call at setup time in both dev and production builds.
    let class_names: &[&std::ffi::CStr] = &[
        c"WKWebView",
        c"WKScrollView",
        c"WKContentView",
        c"WKFlippedView",
    ];

    for class_name in class_names {
        if let Some(cls) = AnyClass::get(class_name) {
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
