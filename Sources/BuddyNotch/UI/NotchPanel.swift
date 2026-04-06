import AppKit
import SwiftUI

final class NotchPanel: NSPanel {

    /// Apple's notch inner corner radius (~8-10pt, superellipse)
    static let notchCornerRadius: CGFloat = 10
    /// Compact height — uses actual safe area inset (notch area) from NSScreen
    static var notchHeight: CGFloat {
        NSScreen.main?.safeAreaInsets.top ?? 32
    }

    init() {
        let frame = Self.compactFrame()

        super.init(
            contentRect: frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        self.isFloatingPanel = true
        self.becomesKeyOnlyIfNeeded = true
        self.hidesOnDeactivate = false
        self.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.statusWindow)) + 1)
        self.collectionBehavior = [
            .canJoinAllSpaces,
            .stationary,
            .fullScreenAuxiliary,
            .ignoresCycle
        ]
        self.isOpaque = false
        self.backgroundColor = .clear
        self.hasShadow = true
        self.ignoresMouseEvents = false
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    // MARK: - Geometry

    static func hasNotch() -> Bool {
        guard let screen = NSScreen.main else { return false }
        return screen.auxiliaryTopLeftArea != nil && screen.auxiliaryTopRightArea != nil
    }

    /// Returns notch geometry: (centerX, topY, notchWidth) in screen coordinates
    static func notchGeometry() -> (centerX: CGFloat, topY: CGFloat, notchWidth: CGFloat)? {
        guard let screen = NSScreen.main,
              let left = screen.auxiliaryTopLeftArea,
              let right = screen.auxiliaryTopRightArea else { return nil }
        let centerX = screen.frame.origin.x + (left.maxX + right.minX) / 2
        let topY = screen.frame.origin.y + screen.frame.height
        let notchWidth = right.minX - left.maxX
        return (centerX, topY, notchWidth)
    }

    /// Compact: wide pill that extends ~90pt on each side of the notch
    static func compactFrame() -> NSRect {
        if let notch = notchGeometry() {
            // Just enough to show buddy on left wing + count badge on right wing
            let sideExtension: CGFloat = 36 // small wing for buddy/badge
            let w = notch.notchWidth + sideExtension * 2
            let h = notchHeight
            return NSRect(x: notch.centerX - w / 2, y: notch.topY - h, width: w, height: h)
        }
        // Non-notch fallback
        guard let screen = NSScreen.main else { return NSRect(x: 0, y: 0, width: 360, height: 32) }
        let w: CGFloat = 360
        let x = screen.frame.origin.x + (screen.frame.width - w) / 2
        let y = screen.frame.origin.y + screen.frame.height - 36 - 32
        return NSRect(x: x, y: y, width: w, height: 32)
    }

    /// Expanded: wider panel that drops down from the notch
    static func expandedFrame(for state: PanelState) -> NSRect {
        let h: CGFloat
        switch state {
        case .compact, .jump: return compactFrame()
        case .overview: h = 300
        case .approval: h = 420
        case .ask: h = 340
        }

        if let notch = notchGeometry() {
            let w: CGFloat = notch.notchWidth + 220  // ~405pt
            return NSRect(x: notch.centerX - w / 2, y: notch.topY - h, width: w, height: h)
        }
        guard let screen = NSScreen.main else { return NSRect(x: 0, y: 0, width: 420, height: h) }
        let w: CGFloat = 420
        let x = screen.frame.origin.x + (screen.frame.width - w) / 2
        let y = screen.frame.origin.y + screen.frame.height - 36 - h
        return NSRect(x: x, y: y, width: w, height: h)
    }

    func transition(to state: PanelState) {
        let targetFrame: NSRect
        switch state {
        case .compact: targetFrame = Self.compactFrame()
        default: targetFrame = Self.expandedFrame(for: state)
        }

        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.15
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            self.animator().setFrame(targetFrame, display: true)
        }
    }
}
