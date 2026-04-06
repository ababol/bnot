import SwiftUI

/// Pixel-art progress bar showing context window usage.
/// Each "block" is a small pixel square that fills up left-to-right.
struct PixelProgressBar: View {
    let percent: Double        // 0.0 to 1.0
    let color: BuddyColor
    let blockCount: Int

    init(percent: Double, color: BuddyColor, blockCount: Int = 12) {
        self.percent = percent
        self.color = color
        self.blockCount = blockCount
    }

    var body: some View {
        Canvas { context, size in
            let gap: CGFloat = 1.5
            let totalGaps = CGFloat(blockCount - 1) * gap
            let blockW = (size.width - totalGaps) / CGFloat(blockCount)
            let blockH = size.height
            let filledCount = Int(Double(blockCount) * min(percent, 1.0))

            for i in 0..<blockCount {
                let x = CGFloat(i) * (blockW + gap)
                let rect = CGRect(x: x, y: 0, width: blockW, height: blockH)
                let isFilled = i < filledCount

                if isFilled {
                    // Filled blocks: use buddy color, brighter near the end
                    let intensity = Double(i) / Double(blockCount)
                    let fillColor = blockColor(intensity: intensity)
                    context.fill(Path(rect), with: .color(fillColor))
                } else {
                    // Empty blocks: dim outline
                    context.fill(Path(rect), with: .color(.white.opacity(0.06)))
                }
            }
        }
    }

    private func blockColor(intensity: Double) -> Color {
        // Blocks get warmer/redder as context fills up
        if intensity > 0.85 {
            // Danger zone — red
            return Color(red: 1.0, green: 0.3, blue: 0.2)
        }
        if intensity > 0.7 {
            // Warning — orange/yellow
            return Color(red: 1.0, green: 0.7, blue: 0.2)
        }
        // Normal — use buddy color
        switch color {
        case .green: return Color(red: 0.29, green: 0.87, blue: 0.50)
        case .blue: return Color(red: 0.38, green: 0.65, blue: 0.98)
        case .orange: return Color(red: 0.98, green: 0.68, blue: 0.34)
        case .cyan: return Color(red: 0.38, green: 0.83, blue: 0.87)
        }
    }
}
