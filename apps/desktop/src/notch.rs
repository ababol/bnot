use objc2::MainThreadMarker;
use objc2_app_kit::NSScreen;
use objc2_foundation::NSRect;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct NotchGeometry {
    #[serde(rename = "centerX")]
    pub center_x: f64,
    #[serde(rename = "topY")]
    pub top_y: f64,
    #[serde(rename = "notchWidth")]
    pub notch_width: f64,
    #[serde(rename = "notchHeight")]
    pub notch_height: f64,
}

/// Read the notch pillar rects from NSScreen to compute notch geometry.
/// Returns None on non-notch Macs.
///
/// Must be called from the main thread.
pub fn get_notch_geometry() -> Option<NotchGeometry> {
    let mtm = MainThreadMarker::from(unsafe { MainThreadMarker::new_unchecked() });

    let screen = NSScreen::mainScreen(mtm)?;
    let frame = screen.frame();
    let safe_area = screen.safeAreaInsets();

    // auxiliaryTopLeftArea / auxiliaryTopRightArea may not be wrapped in objc2-app-kit.
    // Use msg_send! to call them directly.
    let left: Option<NSRect> = unsafe {
        let rect: NSRect = objc2::msg_send![&screen, auxiliaryTopLeftArea];
        // If no notch, these return zero rects
        if rect.size.width > 0.0 { Some(rect) } else { None }
    };
    let right: Option<NSRect> = unsafe {
        let rect: NSRect = objc2::msg_send![&screen, auxiliaryTopRightArea];
        if rect.size.width > 0.0 { Some(rect) } else { None }
    };

    let left = left?;
    let right = right?;

    let center_x = frame.origin.x + (left.origin.x + left.size.width + right.origin.x) / 2.0;
    let top_y = frame.origin.y + frame.size.height;
    let notch_width = right.origin.x - (left.origin.x + left.size.width);
    let notch_height = safe_area.top;

    Some(NotchGeometry {
        center_x,
        top_y,
        notch_width,
        notch_height,
    })
}

/// Get main screen height (for coordinate flipping). Falls back to 900.
pub fn screen_height() -> f64 {
    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    NSScreen::mainScreen(mtm)
        .map(|s| s.frame().size.height)
        .unwrap_or(900.0)
}
