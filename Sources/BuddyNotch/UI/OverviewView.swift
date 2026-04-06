import SwiftUI
import BuddyNotchShared

struct OverviewView: View {
    var sessionManager: SessionManager

    var body: some View {
        VStack(spacing: 0) {
            // Spacer for notch dead zone at top
            Spacer()
                .frame(height: NotchPanel.notchHeight)

            // Header — below the notch
            HStack {
                PixelBuddy(color: sessionManager.buddyColor, isActive: true)
                    .frame(width: 16, height: 14)
                Text("Sessions")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.7))
                Spacer()
                Button(action: { sessionManager.currentPanelState = .compact }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.white.opacity(0.4))
                        .frame(width: 22, height: 22)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .padding(.bottom, 8)

            if sessionManager.sessions.isEmpty {
                Spacer()
                Text("No active sessions")
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.3))
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 6) {
                        ForEach(sessionManager.sortedSessions) { session in
                            SessionCard(
                                session: session,
                                isHero: session.id == (sessionManager.heroSessionId ?? sessionManager.sortedSessions.first?.id)
                            )
                            .onTapGesture {
                                // Jump to the terminal running this session
                                TerminalJumper.jump(to: session)
                                sessionManager.heroSessionId = session.id
                                sessionManager.currentPanelState = .compact
                            }
                        }
                    }
                }
            }
        }
    }
}

struct SessionCard: View {
    let session: AgentSession
    let isHero: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)

                Text(session.taskName ?? session.directoryName)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.white)
                    .lineLimit(1)

                Spacer()

                Text(session.formattedDuration)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.4))
            }

            if isHero {
                if let tool = session.currentTool, tool != "Unknown" {
                    HStack(spacing: 4) {
                        Text(tool)
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                        if let path = session.currentFilePath {
                            Text(shortenPath(path))
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(.white.opacity(0.4))
                                .lineLimit(1)
                        }
                    }
                    .foregroundStyle(.cyan)
                } else {
                    Text(statusText)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(statusColor.opacity(0.8))
                }

                Text(session.workingDirectory)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.3))
                    .lineLimit(1)
                    .truncationMode(.head)

                // Context progress bar
                if session.maxContextTokens > 0 {
                    HStack(spacing: 6) {
                        PixelProgressBar(
                            percent: session.contextPercent,
                            color: buddyColor
                        )
                        .frame(height: 6)

                        Text("\(session.contextTokensShort)/\(session.maxTokensShort)")
                            .font(.system(size: 9, weight: .medium, design: .monospaced))
                            .foregroundStyle(.white.opacity(0.4))
                    }
                    .padding(.top, 2)
                }
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(isHero ? Color.white.opacity(0.08) : Color.white.opacity(0.03))
        )
        .animation(.spring(response: 0.3), value: isHero)
    }

    private var buddyColor: BuddyColor {
        switch session.status {
        case .active: .blue
        case .waitingApproval: .orange
        case .waitingAnswer: .cyan
        case .completed: .green
        case .error: .orange
        }
    }

    private var statusText: String {
        switch session.status {
        case .active: "Working..."
        case .waitingApproval: "Needs approval"
        case .waitingAnswer: "Asking question"
        case .completed: "Completed"
        case .error: "Error"
        }
    }

    private var statusColor: Color {
        switch session.status {
        case .active: .green
        case .waitingApproval: .orange
        case .waitingAnswer: .cyan
        case .completed: .blue
        case .error: .red
        }
    }

    private func shortenPath(_ path: String) -> String {
        let components = (path as NSString).pathComponents
        if components.count > 2 {
            return components.suffix(2).joined(separator: "/")
        }
        return path
    }
}
