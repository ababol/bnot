import SwiftUI

/// 8x8 pixel-art buddy character that lives in the notch.
/// Subtle animation when active: gentle breathing + occasional blink.
struct PixelBuddy: View {
    let color: BuddyColor
    let isActive: Bool
    @State private var frame: Int = 0
    @State private var timer: Timer?

    var body: some View {
        Canvas { context, size in
            let px = min(size.width / 8, size.height / 8)
            let ox = (size.width - px * 8) / 2
            let oy = (size.height - px * 8) / 2

            let main = mainColor
            let bright = brightColor
            let dark = Color.black

            // Blink every ~20 frames (4 seconds)
            let blinking = isActive && (frame % 20 == 0)

            // Ears
            pixel(context, ox: ox, oy: oy, px: px, x: 1, y: 1, color: bright)
            pixel(context, ox: ox, oy: oy, px: px, x: 6, y: 1, color: bright)

            // Head top
            for x in 1...6 {
                pixel(context, ox: ox, oy: oy, px: px, x: x, y: 2, color: main)
            }

            // Eyes row
            pixel(context, ox: ox, oy: oy, px: px, x: 1, y: 3, color: main)
            pixel(context, ox: ox, oy: oy, px: px, x: 2, y: 3, color: blinking ? main : dark)
            pixel(context, ox: ox, oy: oy, px: px, x: 3, y: 3, color: main)
            pixel(context, ox: ox, oy: oy, px: px, x: 4, y: 3, color: main)
            pixel(context, ox: ox, oy: oy, px: px, x: 5, y: 3, color: blinking ? main : dark)
            pixel(context, ox: ox, oy: oy, px: px, x: 6, y: 3, color: main)

            // Body
            for x in 1...6 {
                pixel(context, ox: ox, oy: oy, px: px, x: x, y: 4, color: main)
            }

            // Feet
            pixel(context, ox: ox, oy: oy, px: px, x: 1, y: 5, color: main)
            pixel(context, ox: ox, oy: oy, px: px, x: 2, y: 5, color: main)
            pixel(context, ox: ox, oy: oy, px: px, x: 5, y: 5, color: main)
            pixel(context, ox: ox, oy: oy, px: px, x: 6, y: 5, color: main)
        }
        // Gentle breathing: slight vertical bob
        .offset(y: isActive ? (frame % 6 < 3 ? -0.5 : 0.5) : 0)
        .onAppear { startAnimating() }
        .onDisappear { stopAnimating() }
        .onChange(of: isActive) { _, active in
            if active { startAnimating() } else { stopAnimating() }
        }
    }

    private func startAnimating() {
        guard isActive, timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
            frame += 1
        }
    }

    private func stopAnimating() {
        timer?.invalidate()
        timer = nil
        frame = 0
    }

    private func pixel(_ context: GraphicsContext, ox: CGFloat, oy: CGFloat, px: CGFloat, x: Int, y: Int, color: Color) {
        let rect = CGRect(x: ox + CGFloat(x) * px, y: oy + CGFloat(y) * px, width: px, height: px)
        context.fill(Path(rect), with: .color(color))
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
}
