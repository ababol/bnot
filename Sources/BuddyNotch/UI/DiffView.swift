import SwiftUI

struct DiffView: View {
    let diff: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                HStack(spacing: 0) {
                    // Line number
                    Text(lineNumber(for: line, index: index))
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.25))
                        .frame(width: 28, alignment: .trailing)
                        .padding(.trailing, 6)

                    // Line prefix indicator
                    Text(linePrefix(line))
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(prefixColor(line))
                        .frame(width: 12)

                    // Line content
                    Text(lineContent(line))
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(lineColor(line))
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 6)
                .padding(.vertical, 1)
                .background(lineBackground(line))
            }
        }
        .padding(.vertical, 6)
    }

    private var lines: [String] {
        diff.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    }

    private func lineNumber(for line: String, index: Int) -> String {
        if line.hasPrefix("@@") || line.hasPrefix("---") || line.hasPrefix("+++") { return "" }
        return "\(index + 1)"
    }

    private func linePrefix(_ line: String) -> String {
        if line.hasPrefix("+") && !line.hasPrefix("+++") { return "+" }
        if line.hasPrefix("-") && !line.hasPrefix("---") { return "-" }
        return " "
    }

    private func lineContent(_ line: String) -> String {
        if (line.hasPrefix("+") || line.hasPrefix("-")) && !line.hasPrefix("+++") && !line.hasPrefix("---") {
            return String(line.dropFirst())
        }
        return line
    }

    private func lineColor(_ line: String) -> Color {
        if line.hasPrefix("+") && !line.hasPrefix("+++") { return .green }
        if line.hasPrefix("-") && !line.hasPrefix("---") { return .red }
        if line.hasPrefix("@@") { return .cyan }
        return .white.opacity(0.5)
    }

    private func prefixColor(_ line: String) -> Color {
        if line.hasPrefix("+") && !line.hasPrefix("+++") { return .green }
        if line.hasPrefix("-") && !line.hasPrefix("---") { return .red }
        return .clear
    }

    private func lineBackground(_ line: String) -> Color {
        if line.hasPrefix("+") && !line.hasPrefix("+++") { return .green.opacity(0.08) }
        if line.hasPrefix("-") && !line.hasPrefix("---") { return .red.opacity(0.08) }
        return .clear
    }
}
