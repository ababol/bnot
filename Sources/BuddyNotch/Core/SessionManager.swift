import Foundation
import BuddyNotchShared

@Observable
final class SessionManager {
    var sessions: [String: AgentSession] = [:]
    var heroSessionId: String?
    var currentPanelState: PanelState = .compact

    /// Client file descriptors waiting for approval responses
    var pendingApprovalClients: [String: Int32] = [:]

    /// Weak ref to socket server for sending responses
    var socketServer: SocketServer?

    // MARK: - Computed

    var sortedSessions: [AgentSession] {
        sessions.values
            .sorted { $0.workingDirectory < $1.workingDirectory }
    }

    var heroSession: AgentSession? {
        if let id = heroSessionId { return sessions[id] }
        return sortedSessions.first
    }

    var activeSessions: [AgentSession] {
        sessions.values.filter { $0.status == .active || $0.status == .waitingApproval || $0.status == .waitingAnswer }
    }

    /// True if any session is actively working (not idle)
    var hasWorkingSessions: Bool {
        sessions.values.contains(where: { $0.status == .active && !$0.isIdle })
    }

    var buddyColor: BuddyColor {
        if sessions.values.contains(where: { $0.status == .waitingApproval }) { return .orange }
        if sessions.values.contains(where: { $0.status == .waitingAnswer }) { return .cyan }
        if sessions.values.contains(where: { $0.status == .active }) { return .blue }
        if !sessions.isEmpty { return .green }
        return .green
    }

    // MARK: - Message Handling (called on main thread via DispatchQueue.main)

    func handleMessage(_ message: SocketMessage, clientFd: Int32) {
        switch message.payload {
        case .sessionStart(let payload):
            // Idempotent — only create if new, otherwise update metadata
            if sessions[message.sessionId] == nil {
                var session = AgentSession(id: message.sessionId, workingDirectory: payload.workingDirectory)
                session.taskName = payload.taskName
                session.terminalApp = payload.terminalApp
                session.terminalPid = payload.terminalPid
                sessions[message.sessionId] = session
            } else {
                // Update metadata if provided
                if let name = payload.taskName { sessions[message.sessionId]?.taskName = name }
                if let app = payload.terminalApp { sessions[message.sessionId]?.terminalApp = app }
                if let pid = payload.terminalPid { sessions[message.sessionId]?.terminalPid = pid }
            }
            sessions[message.sessionId]?.lastActivity = message.timestamp
            if heroSessionId == nil { heroSessionId = message.sessionId }

        case .preToolUse(let payload):
            ensureSession(for: message)

            sessions[message.sessionId]?.lastActivity = message.timestamp
            sessions[message.sessionId]?.currentTool = payload.toolName
            sessions[message.sessionId]?.currentFilePath = payload.filePath
            sessions[message.sessionId]?.status = .active

        case .postToolUse:
            ensureSession(for: message)
            sessions[message.sessionId]?.lastActivity = message.timestamp
            sessions[message.sessionId]?.currentTool = nil
            sessions[message.sessionId]?.pendingApproval = nil
            if sessions[message.sessionId]?.status == .waitingApproval {
                sessions[message.sessionId]?.status = .active
            }
            pendingApprovalClients.removeValue(forKey: message.sessionId)

            if case .approval(let id) = currentPanelState, id == message.sessionId {
                currentPanelState = .compact
            }

        case .notification(let payload):
            ensureSession(for: message)
            sessions[message.sessionId]?.lastActivity = message.timestamp

            if payload.level == .success || payload.title.lowercased().contains("complete") {
                sessions[message.sessionId]?.status = .completed
                heroSessionId = message.sessionId
                currentPanelState = .jump(message.sessionId)

                let sessionId = message.sessionId
                DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in
                    if case .jump(let id) = self?.currentPanelState, id == sessionId {
                        self?.currentPanelState = .compact
                    }
                }
            }

        case .sessionEnd:
            ensureSession(for: message)
            sessions[message.sessionId]?.status = .completed
            sessions[message.sessionId]?.lastActivity = message.timestamp
            pendingApprovalClients.removeValue(forKey: message.sessionId)

            heroSessionId = message.sessionId
            currentPanelState = .jump(message.sessionId)

            let sessionId = message.sessionId
            DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in
                if case .jump(let id) = self?.currentPanelState, id == sessionId {
                    self?.currentPanelState = .compact
                    self?.sessions.removeValue(forKey: sessionId)
                }
            }

        case .stop:
            sessions[message.sessionId]?.status = .completed
            pendingApprovalClients.removeValue(forKey: message.sessionId)

        case .heartbeat:
            sessions[message.sessionId]?.lastActivity = message.timestamp
        }
    }

    private func ensureSession(for message: SocketMessage) {
        if sessions[message.sessionId] == nil {
            var session = AgentSession(id: message.sessionId, workingDirectory: "unknown")
            session.lastActivity = message.timestamp
            sessions[message.sessionId] = session
            if heroSessionId == nil { heroSessionId = message.sessionId }
        }
    }

    // MARK: - Actions

    func approveSession(_ sessionId: String) {
        guard let clientFd = pendingApprovalClients[sessionId] else { return }
        let response = ApprovalResponse(action: .allow)
        socketServer?.sendResponse(response, to: clientFd)

        sessions[sessionId]?.pendingApproval = nil
        sessions[sessionId]?.status = .active
        pendingApprovalClients.removeValue(forKey: sessionId)
        currentPanelState = .compact
    }

    func denySession(_ sessionId: String) {
        guard let clientFd = pendingApprovalClients[sessionId] else { return }
        let response = ApprovalResponse(action: .deny)
        socketServer?.sendResponse(response, to: clientFd)

        sessions[sessionId]?.pendingApproval = nil
        sessions[sessionId]?.status = .active
        pendingApprovalClients.removeValue(forKey: sessionId)
        currentPanelState = .compact
    }

    func answerSession(_ sessionId: String, optionIndex: Int) {
        sessions[sessionId]?.pendingQuestion = nil
        sessions[sessionId]?.status = .active
        currentPanelState = .compact
    }
}

// MARK: - Panel State

enum PanelState: Equatable {
    case compact
    case overview
    case approval(String)
    case ask(String)
    case jump(String)
}

enum BuddyColor {
    case green, blue, orange, cyan
}
