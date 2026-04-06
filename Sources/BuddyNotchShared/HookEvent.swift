import Foundation

// MARK: - Socket Wire Protocol (NDJSON)

/// Top-level envelope for all messages over the Unix socket
public struct SocketMessage: Codable, Sendable {
    public let type: MessageType
    public let sessionId: String
    public let timestamp: Date
    public let payload: MessagePayload

    public init(type: MessageType, sessionId: String, timestamp: Date = .now, payload: MessagePayload) {
        self.type = type
        self.sessionId = sessionId
        self.timestamp = timestamp
        self.payload = payload
    }

    enum CodingKeys: String, CodingKey {
        case type, sessionId, timestamp, payload
    }
}

public enum MessageType: String, Codable, Sendable {
    case preToolUse
    case postToolUse
    case notification
    case sessionStart
    case sessionEnd
    case stop
    case heartbeat
}

public enum MessagePayload: Codable, Sendable {
    case preToolUse(PreToolUsePayload)
    case postToolUse(PostToolUsePayload)
    case notification(NotificationPayload)
    case sessionStart(SessionStartPayload)
    case sessionEnd(SessionEndPayload)
    case stop(StopPayload)
    case heartbeat

    enum CodingKeys: String, CodingKey {
        case preToolUse, postToolUse, notification, sessionStart, sessionEnd, stop, heartbeat
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let v = try container.decodeIfPresent(PreToolUsePayload.self, forKey: .preToolUse) {
            self = .preToolUse(v)
        } else if let v = try container.decodeIfPresent(PostToolUsePayload.self, forKey: .postToolUse) {
            self = .postToolUse(v)
        } else if let v = try container.decodeIfPresent(NotificationPayload.self, forKey: .notification) {
            self = .notification(v)
        } else if let v = try container.decodeIfPresent(SessionStartPayload.self, forKey: .sessionStart) {
            self = .sessionStart(v)
        } else if let v = try container.decodeIfPresent(SessionEndPayload.self, forKey: .sessionEnd) {
            self = .sessionEnd(v)
        } else if let v = try container.decodeIfPresent(StopPayload.self, forKey: .stop) {
            self = .stop(v)
        } else {
            self = .heartbeat
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .preToolUse(let v): try container.encode(v, forKey: .preToolUse)
        case .postToolUse(let v): try container.encode(v, forKey: .postToolUse)
        case .notification(let v): try container.encode(v, forKey: .notification)
        case .sessionStart(let v): try container.encode(v, forKey: .sessionStart)
        case .sessionEnd(let v): try container.encode(v, forKey: .sessionEnd)
        case .stop(let v): try container.encode(v, forKey: .stop)
        case .heartbeat: try container.encode(true, forKey: .heartbeat)
        }
    }
}

// MARK: - Payloads

public struct PreToolUsePayload: Codable, Sendable {
    public let toolName: String
    public let filePath: String?
    public let input: String?
    public let diffPreview: String?

    public init(toolName: String, filePath: String? = nil, input: String? = nil, diffPreview: String? = nil) {
        self.toolName = toolName
        self.filePath = filePath
        self.input = input
        self.diffPreview = diffPreview
    }
}

public struct PostToolUsePayload: Codable, Sendable {
    public let toolName: String
    public let filePath: String?
    public let wasApproved: Bool

    public init(toolName: String, filePath: String? = nil, wasApproved: Bool = true) {
        self.toolName = toolName
        self.filePath = filePath
        self.wasApproved = wasApproved
    }
}

public struct NotificationPayload: Codable, Sendable {
    public let title: String
    public let body: String
    public let level: NotificationLevel

    public init(title: String, body: String, level: NotificationLevel = .info) {
        self.title = title
        self.body = body
        self.level = level
    }
}

public enum NotificationLevel: String, Codable, Sendable {
    case info, warning, error, success
}

public struct SessionStartPayload: Codable, Sendable {
    public let taskName: String?
    public let workingDirectory: String
    public let terminalApp: String?
    public let terminalPid: Int?

    public init(taskName: String? = nil, workingDirectory: String, terminalApp: String? = nil, terminalPid: Int? = nil) {
        self.taskName = taskName
        self.workingDirectory = workingDirectory
        self.terminalApp = terminalApp
        self.terminalPid = terminalPid
    }
}

public struct SessionEndPayload: Codable, Sendable {
    public let reason: String?

    public init(reason: String? = nil) {
        self.reason = reason
    }
}

public struct StopPayload: Codable, Sendable {
    public let reason: String?

    public init(reason: String? = nil) {
        self.reason = reason
    }
}

// MARK: - Response (server -> bridge)

public struct ApprovalResponse: Codable, Sendable {
    public let action: ApprovalAction

    public init(action: ApprovalAction) {
        self.action = action
    }
}

public enum ApprovalAction: String, Codable, Sendable {
    case allow
    case deny
}
