use std::sync::OnceLock;

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

static CACHED_GEOMETRY: OnceLock<NotchGeometry> = OnceLock::new();

/// Read the notch pillar rects from NSScreen to compute notch geometry.
/// Returns None on non-notch Macs.
///
/// Must be called from the main thread.
pub fn get_notch_geometry() -> Option<NotchGeometry> {
    // Return cached geometry if available (notch APIs may stop working
    // after NSApplication switches to Accessory activation policy)
    if let Some(cached) = CACHED_GEOMETRY.get() {
        return Some(cached.clone());
    }

    let mtm = MainThreadMarker::from(unsafe { MainThreadMarker::new_unchecked() });

    let screen = NSScreen::mainScreen(mtm)?;
    let frame = screen.frame();
    let safe_area = screen.safeAreaInsets();

    // auxiliaryTopLeftArea / auxiliaryTopRightArea may not be wrapped in objc2-app-kit.
    // Use msg_send! to call them directly.
    let left: Option<NSRect> = unsafe {
        let rect: NSRect = objc2::msg_send![&screen, auxiliaryTopLeftArea];
        eprintln!("[notch] left area: {:?}", rect);
        if rect.size.width > 0.0 { Some(rect) } else { None }
    };
    let right: Option<NSRect> = unsafe {
        let rect: NSRect = objc2::msg_send![&screen, auxiliaryTopRightArea];
        eprintln!("[notch] right area: {:?}", rect);
        if rect.size.width > 0.0 { Some(rect) } else { None }
    };

    eprintln!("[notch] frame: {:?}, safeArea.top: {}", frame, safe_area.top);

    let (center_x, top_y, notch_width, notch_height) = if let (Some(left), Some(right)) = (left, right) {
        let cx = frame.origin.x + (left.origin.x + left.size.width + right.origin.x) / 2.0;
        let ty = frame.origin.y + frame.size.height;
        let nw = right.origin.x - (left.origin.x + left.size.width);
        let nh = safe_area.top;
        (cx, ty, nw, nh)
    } else {
        // Fallback: estimate notch geometry from screen dimensions.
        // auxiliaryTopLeftArea/Right may return zero when running as a debug binary
        // (not a bundled .app). Detect notched Macs by their non-standard screen heights:
        // 14" = 900pt, 16" = 1117pt (both have fractional backing scale factors)
        let h = frame.size.height;
        let has_notch = h == 1117.0 || h == 900.0 || h == 1120.0 || h == 982.0;
        if !has_notch {
            return None;
        }
        let cx = frame.origin.x + frame.size.width / 2.0;
        let ty = frame.origin.y + frame.size.height;
        let nw = 200.0;
        let nh = 32.0;
        eprintln!("[notch] using estimated geometry for h={}", h);
        (cx, ty, nw, nh)
    };

    let geom = NotchGeometry {
        center_x,
        top_y,
        notch_width,
        notch_height,
    };

    // Cache for future calls
    let _ = CACHED_GEOMETRY.set(geom.clone());

    Some(geom)
}

/// Get main screen height (for coordinate flipping). Falls back to 900.
pub fn screen_height() -> f64 {
    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    NSScreen::mainScreen(mtm)
        .map(|s| s.frame().size.height)
        .unwrap_or(900.0)
}
