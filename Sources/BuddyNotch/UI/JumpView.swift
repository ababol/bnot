import SwiftUI
import BuddyNotchShared

struct JumpView: View {
    var sessionManager: SessionManager
    let sessionId: String

    private var session: AgentSession? { sessionManager.sessions[sessionId] }

    var body: some View {
        VStack(spacing: 16) {
            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 32))
                .foregroundStyle(.green)

            VStack(spacing: 4) {
                Text("Done")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)

                Text(session?.taskName ?? session?.directoryName ?? "Task")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.5))
            }

            Button(action: jump) {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.up.forward.app")
                        .font(.system(size: 13))
                    Text("Jump to terminal")
                        .font(.system(size: 13, weight: .medium))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color.blue.opacity(0.3))
                )
            }
            .buttonStyle(.plain)
            .foregroundStyle(.white)

            Spacer()
        }
        .contentShape(Rectangle())
        .onTapGesture { jump() }
    }

    private func jump() {
        if let session = session {
            TerminalJumper.jump(to: session)
        }
        sessionManager.currentPanelState = .compact
    }
}
