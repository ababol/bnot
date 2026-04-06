import SwiftUI

struct CompactView: View {
    var sessionManager: SessionManager

    /// The notch gap width — content must avoid this dead zone in the center
    private var notchGap: CGFloat {
        if let geo = NotchPanel.notchGeometry() {
            return geo.notchWidth + 16 // notch width + small margin
        }
        return 200
    }

    private var isJump: Bool {
        if case .jump = sessionManager.currentPanelState { return true }
        return false
    }

    private var jumpSessionId: String? {
        if case .jump(let id) = sessionManager.currentPanelState { return id }
        return nil
    }

    var body: some View {
        HStack(spacing: 0) {
            // LEFT WING
            HStack(spacing: 6) {
                if isJump {
                    // Success checkmark — clickable to jump to terminal
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(.green)
                        .onTapGesture {
                            if let id = jumpSessionId, let session = sessionManager.sessions[id] {
                                TerminalJumper.jump(to: session)
                            }
                            sessionManager.currentPanelState = .compact
                        }
                } else {
                    BuddyBattery(
                        color: sessionManager.buddyColor,
                        percent: sessionManager.heroSession?.contextPercent ?? 0,
                        isActive: sessionManager.hasWorkingSessions
                    )
                    .frame(width: 28, height: 18)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            // CENTER — dead zone (behind notch), keep empty
            Spacer()
                .frame(width: notchGap)

            // RIGHT WING — session count badge
            HStack(spacing: 6) {
                if sessionManager.sessions.count > 0 {
                    Text("\(sessionManager.sessions.count)")
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.7))
                        .frame(width: 20, height: 20)
                        .background(
                            RoundedRectangle(cornerRadius: 5)
                                .fill(Color.white.opacity(0.12))
                        )
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if sessionManager.sessions.isEmpty { return }
            sessionManager.currentPanelState = .overview
        }
    }
}

/// Pixel buddy with a context fill overlay — like a battery indicator.
/// The buddy's body fills up from bottom to top based on context usage.
struct BuddyBattery: View {
    let color: BuddyColor
    let percent: Double
    let isActive: Bool
    @State private var frame: Int = 0
    @State private var timer: Timer?

    var body: some View {
        Canvas { context, size in
            let px = min(size.width / 8, size.height / 8)
            let ox = (size.width - px * 8) / 2
            let oy = (size.height - px * 8) / 2
            let dark = Color.black
            let sleepColor = Color.white.opacity(0.2)

            if !isActive {
                // SLEEPING: buddy with closed eyes (horizontal line) + floating Zzz
                drawSleepingBuddy(context: context, ox: ox, oy: oy, px: px, dark: dark, sleepColor: sleepColor)
            } else {
                // ACTIVE: battery-fill buddy
                let blinking = (frame % 20 == 0)
                let minRow = 1
                let maxRow = 5
                let fillRow = maxRow - Int(Double(maxRow - minRow) * min(percent, 1.0))

                let pixels: [(x: Int, y: Int, isEar: Bool, isEye: Bool)] = [
                    (1, 1, true, false), (6, 1, true, false),
                    (1, 2, false, false), (2, 2, false, false), (3, 2, false, false),
                    (4, 2, false, false), (5, 2, false, false), (6, 2, false, false),
                    (1, 3, false, false), (2, 3, false, true), (3, 3, false, false),
                    (4, 3, false, false), (5, 3, false, true), (6, 3, false, false),
                    (1, 4, false, false), (2, 4, false, false), (3, 4, false, false),
                    (4, 4, false, false), (5, 4, false, false), (6, 4, false, false),
                    (1, 5, false, false), (2, 5, false, false),
                    (5, 5, false, false), (6, 5, false, false),
                ]

                for p in pixels {
                    let rect = CGRect(x: ox + CGFloat(p.x) * px, y: oy + CGFloat(p.y) * px, width: px, height: px)
                    let c: Color
                    if p.isEye {
                        c = blinking ? contextColor : dark
                    } else if p.isEar {
                        c = contextColor.opacity(0.7)
                    } else if p.y >= fillRow {
                        c = contextColor
                    } else {
                        c = dimColor
                    }
                    context.fill(Path(rect), with: .color(c))
                }
            }
        }
        .offset(y: isActive ? (frame % 6 < 3 ? -0.5 : 0.5) : 0)
        .onAppear { startTimer() }
        .onDisappear { stopTimer() }
    }

    private func drawSleepingBuddy(context: GraphicsContext, ox: CGFloat, oy: CGFloat, px: CGFloat, dark: Color, sleepColor: Color) {
        let bodyColor = Color.white.opacity(0.8)

        // Ears
        pixel(context, ox: ox, oy: oy, px: px, x: 1, y: 1, color: Color.white.opacity(0.6))
        pixel(context, ox: ox, oy: oy, px: px, x: 6, y: 1, color: Color.white.opacity(0.6))
        // Head
        for x in 1...6 { pixel(context, ox: ox, oy: oy, px: px, x: x, y: 2, color: bodyColor) }
        // Eyes: closed (horizontal line instead of dots)
        pixel(context, ox: ox, oy: oy, px: px, x: 1, y: 3, color: bodyColor)
        pixel(context, ox: ox, oy: oy, px: px, x: 2, y: 3, color: Color.white.opacity(0.3))
        pixel(context, ox: ox, oy: oy, px: px, x: 3, y: 3, color: Color.white.opacity(0.3))
        pixel(context, ox: ox, oy: oy, px: px, x: 4, y: 3, color: Color.white.opacity(0.3))
        pixel(context, ox: ox, oy: oy, px: px, x: 5, y: 3, color: Color.white.opacity(0.3))
        pixel(context, ox: ox, oy: oy, px: px, x: 6, y: 3, color: bodyColor)
        // Body
        for x in 1...6 { pixel(context, ox: ox, oy: oy, px: px, x: x, y: 4, color: bodyColor) }
        // Feet
        pixel(context, ox: ox, oy: oy, px: px, x: 1, y: 5, color: bodyColor)
        pixel(context, ox: ox, oy: oy, px: px, x: 2, y: 5, color: bodyColor)
        pixel(context, ox: ox, oy: oy, px: px, x: 5, y: 5, color: bodyColor)
        pixel(context, ox: ox, oy: oy, px: px, x: 6, y: 5, color: bodyColor)

        // Zzz — three z's floating up and to the right, cycling position
        let zColor = Color.white.opacity(0.7)
        let cycle = frame % 12 // slow cycle
        // Small z (closest to buddy)
        let z1y = 1 - (cycle < 4 ? 0 : (cycle < 8 ? 1 : 2))
        if z1y >= -1 && z1y <= 2 {
            pixel(context, ox: ox, oy: oy, px: px, x: 7, y: z1y + 2, color: zColor.opacity(0.6))
        }
        // Medium z
        if cycle >= 4 {
            let z2y = cycle < 8 ? 0 : -1
            pixel(context, ox: ox, oy: oy, px: px, x: 7, y: z2y + 1, color: zColor.opacity(0.4))
        }
        // Large z (farthest)
        if cycle >= 8 {
            pixel(context, ox: ox, oy: oy, px: px, x: 7, y: 0, color: zColor.opacity(0.2))
        }
    }

    private func pixel(_ context: GraphicsContext, ox: CGFloat, oy: CGFloat, px: CGFloat, x: Int, y: Int, color: Color) {
        let rect = CGRect(x: ox + CGFloat(x) * px, y: oy + CGFloat(y) * px, width: px, height: px)
        context.fill(Path(rect), with: .color(color))
    }

    private func fillColor(row: Int, maxRow: Int) -> Color {
        contextColor
    }

    /// Buddy color based on context fill: green → yellow → red
    private var contextColor: Color {
        if percent > 0.85 { return Color(red: 1.0, green: 0.2, blue: 0.2) }  // red: <15% remaining
        if percent > 0.6 { return Color(red: 1.0, green: 0.75, blue: 0.1) }   // yellow: >60% used
        return Color(red: 0.29, green: 0.87, blue: 0.50)                       // green: plenty of space
    }

    private func startTimer() {
        guard timer == nil else { return }
        // Always animate: active = breathing, idle = Zzz
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in frame += 1 }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
        frame = 0
    }

    private var mainColor: Color {
        switch color {
        case .green: Color(red: 0.29, green: 0.87, blue: 0.50)
        case .blue: Color(red: 0.38, green: 0.65, blue: 0.98)
        case .orange: Color(red: 0.98, green: 0.68, blue: 0.34)
        case .cyan: Color(red: 0.38, green: 0.83, blue: 0.87)
        }
    }

    private var brightColor: Color {
        switch color {
        case .green: Color(red: 0.50, green: 1.0, blue: 0.65)
        case .blue: Color(red: 0.55, green: 0.80, blue: 1.0)
        case .orange: Color(red: 1.0, green: 0.85, blue: 0.50)
        case .cyan: Color(red: 0.55, green: 1.0, blue: 1.0)
        }
    }

    private var dimColor: Color {
        Color.white.opacity(0.08)
    }
}
