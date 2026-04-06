import SwiftUI

struct NotchContentView: View {
    var sessionManager: SessionManager
    let panelRef: NotchPanel

    var body: some View {
        ZStack(alignment: .top) {
            // Background
            UnevenRoundedRectangle(
                topLeadingRadius: 0,
                bottomLeadingRadius: cornerRadius,
                bottomTrailingRadius: cornerRadius,
                topTrailingRadius: 0
            )
            .fill(.black)

            // Content
            VStack(spacing: 0) {
                if isCompactSize {
                    CompactView(sessionManager: sessionManager)
                        .frame(height: NotchPanel.notchHeight)
                } else {
                    switch sessionManager.currentPanelState {
                    case .compact, .jump:
                        EmptyView()
                    case .overview:
                        OverviewView(sessionManager: sessionManager)
                    case .approval(let sessionId):
                        ApprovalView(sessionManager: sessionManager, sessionId: sessionId)
                            .padding(.top, NotchPanel.notchHeight + 4)
                    case .ask(let sessionId):
                        AskView(sessionManager: sessionManager, sessionId: sessionId)
                            .padding(.top, NotchPanel.notchHeight + 4)
                    }
                }
            }
            .padding(.horizontal, isCompactSize ? 10 : 14)
            .padding(.top, isCompactSize ? 2 : 0)
            .padding(.bottom, isCompactSize ? 2 : 10)
        }
    }

    private var isCompactSize: Bool {
        switch sessionManager.currentPanelState {
        case .compact, .jump: return true
        default: return false
        }
    }

    private var cornerRadius: CGFloat {
        NotchPanel.hasNotch() ? 16 : 10
    }
}
