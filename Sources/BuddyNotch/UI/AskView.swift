import SwiftUI
import BuddyNotchShared

struct AskView: View {
    var sessionManager: SessionManager
    let sessionId: String

    private var session: AgentSession? { sessionManager.sessions[sessionId] }
    private var question: QuestionRequest? { session?.pendingQuestion }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack(spacing: 6) {
                Image(systemName: "bubble.left.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(.cyan)
                Text("Claude asks")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                Spacer()
            }

            // Question
            Text(question?.question ?? "")
                .font(.system(size: 13))
                .foregroundStyle(.white.opacity(0.9))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 4)

            // Options
            ForEach(Array((question?.options ?? []).enumerated()), id: \.offset) { index, option in
                Button(action: { sessionManager.answerSession(sessionId, optionIndex: index) }) {
                    HStack(spacing: 8) {
                        Text("\u{2318}\(index + 1)")
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundStyle(.cyan.opacity(0.6))
                            .frame(width: 28)
                        Text(option)
                            .font(.system(size: 12))
                            .foregroundStyle(.white)
                        Spacer()
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.white.opacity(0.06))
                    )
                }
                .buttonStyle(.plain)
            }

            Spacer()
        }
    }
}
