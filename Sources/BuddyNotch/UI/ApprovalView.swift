import SwiftUI
import BuddyNotchShared

struct ApprovalView: View {
    var sessionManager: SessionManager
    let sessionId: String

    private var session: AgentSession? { sessionManager.sessions[sessionId] }
    private var approval: ApprovalRequest? { session?.pendingApproval }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack(spacing: 6) {
                Circle()
                    .fill(.orange)
                    .frame(width: 8, height: 8)
                Text("Permission Request")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.6))
                Spacer()
            }

            // Tool + file path
            HStack(spacing: 6) {
                Text("\u{26A0}")
                    .font(.system(size: 14))
                Text(approval?.toolName ?? "Tool")
                    .font(.system(size: 15, weight: .bold, design: .monospaced))
                    .foregroundStyle(.orange)
                if let filePath = approval?.filePath {
                    Text(filePath)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.6))
                        .lineLimit(1)
                        .truncationMode(.head)
                }
            }

            // Diff preview or command
            if let diff = approval?.diffPreview, !diff.isEmpty {
                ScrollView {
                    DiffView(diff: diff)
                }
                .frame(maxHeight: 200)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color(white: 0.08))
                )
                .clipShape(RoundedRectangle(cornerRadius: 8))
            } else if let input = approval?.input, !input.isEmpty {
                ScrollView {
                    Text(input)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.green)
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 120)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color(white: 0.08))
                )
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            Spacer(minLength: 4)

            // Diff summary
            if let diff = approval?.diffPreview {
                let (added, removed) = diffStats(diff)
                if added > 0 || removed > 0 {
                    Text("+\(added) -\(removed)")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.4))
                }
            }

            // Action buttons
            HStack(spacing: 10) {
                Button(action: { sessionManager.denySession(sessionId) }) {
                    HStack {
                        Text("Deny")
                            .font(.system(size: 13, weight: .medium))
                        Text("\u{2318}N")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.white.opacity(0.4))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.white.opacity(0.08))
                    )
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white)

                Button(action: { sessionManager.approveSession(sessionId) }) {
                    HStack {
                        Text("Allow")
                            .font(.system(size: 13, weight: .semibold))
                        Text("\u{2318}Y")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.black.opacity(0.5))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.white.opacity(0.9))
                    )
                }
                .buttonStyle(.plain)
                .foregroundStyle(.black)
            }
        }
    }

    private func diffStats(_ diff: String) -> (Int, Int) {
        var added = 0
        var removed = 0
        for line in diff.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix("+") && !line.hasPrefix("+++") { added += 1 }
            if line.hasPrefix("-") && !line.hasPrefix("---") { removed += 1 }
        }
        return (added, removed)
    }
}
