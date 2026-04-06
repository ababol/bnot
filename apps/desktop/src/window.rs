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
        "overview" => (geom.notch_width + 220.0, 300.0),
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

/// Swizzle `acceptsFirstMouse:` on the window's content view hierarchy
/// so clicks go through immediately without needing to focus the window first.
#[cfg(target_os = "macos")]
unsafe fn swizzle_accepts_first_mouse(ns_window: &objc2::rc::Retained<objc2::runtime::AnyObject>) {
    use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
    use std::sync::Once;

    // Get the content view
    let content_view: *mut AnyObject = objc2::msg_send![&**ns_window, contentView];
    if content_view.is_null() {
        return;
    }

    // Walk the view hierarchy to find the WKWebView (or its subview that handles events)
    // We'll swizzle on the content view's class and all subviews
    swizzle_view_class(content_view);

    // Also swizzle all subviews recursively
    let subviews: *mut AnyObject = objc2::msg_send![content_view, subviews];
    if !subviews.is_null() {
        let count: usize = objc2::msg_send![subviews, count];
        for i in 0..count {
            let subview: *mut AnyObject = objc2::msg_send![subviews, objectAtIndex: i];
            if !subview.is_null() {
                swizzle_view_class(subview);
                // Go one more level deep for WKWebView's internal views
                let inner_subviews: *mut AnyObject = objc2::msg_send![subview, subviews];
                if !inner_subviews.is_null() {
                    let inner_count: usize = objc2::msg_send![inner_subviews, count];
                    for j in 0..inner_count {
                        let inner: *mut AnyObject =
                            objc2::msg_send![inner_subviews, objectAtIndex: j];
                        if !inner.is_null() {
                            swizzle_view_class(inner);
                        }
                    }
                }
            }
        }
    }
}

/// Add/replace `acceptsFirstMouse:` on a view's class to return YES
#[cfg(target_os = "macos")]
unsafe fn swizzle_view_class(view: *mut objc2::runtime::AnyObject) {
    use objc2::runtime::{AnyClass, Bool, Sel};

    let cls: *const AnyClass = objc2::msg_send![view, class];
    if cls.is_null() {
        return;
    }

    let sel = Sel::register(c"acceptsFirstMouse:");

    // Define the replacement function
    extern "C" fn yes_accepts_first_mouse(
        _this: &objc2::runtime::AnyObject,
        _sel: Sel,
        _event: *mut objc2::runtime::AnyObject,
    ) -> Bool {
        Bool::YES
    }

    // Add or replace the method on this class
    let _ = objc2::runtime::AnyClass::get(c"NSObject"); // ensure runtime is initialized
    let added = class_addMethod(
        cls as *mut _,
        sel,
        yes_accepts_first_mouse as *const std::ffi::c_void,
        "B@:@\0".as_ptr() as *const i8,
    );
    if !added {
        // Method already exists, replace it
        class_replaceMethod(
            cls as *mut _,
            sel,
            yes_accepts_first_mouse as *const std::ffi::c_void,
            "B@:@\0".as_ptr() as *const i8,
        );
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
