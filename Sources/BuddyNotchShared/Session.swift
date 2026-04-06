import Foundation

public struct AgentSession: Identifiable, Sendable {
    public let id: String
    public var taskName: String?
    public var workingDirectory: String
    public var terminalApp: String?
    public var terminalPid: Int?
    public var status: SessionStatus
    public var startedAt: Date
    public var lastActivity: Date
    public var currentTool: String?
    public var currentFilePath: String?
    public var pendingApproval: ApprovalRequest?
    public var pendingQuestion: QuestionRequest?
    public var contextTokens: Int = 0
    public var maxContextTokens: Int = 0
    public var modelName: String?
    public var sessionFilePath: String?
    public var tty: String?             // e.g. "ttys001"
    public var processPid: Int?         // PID of the claude process itself
    public var cpuPercent: Double = 0   // Current CPU usage (0 = idle)

    public init(id: String, workingDirectory: String, startedAt: Date = .now) {
        self.id = id
        self.workingDirectory = workingDirectory
        self.status = .active
        self.startedAt = startedAt
        self.lastActivity = startedAt
    }

    public var formattedDuration: String {
        let elapsed = Date.now.timeIntervalSince(startedAt)
        if elapsed < 60 { return "\(Int(elapsed))s" }
        if elapsed < 3600 { return "\(Int(elapsed / 60))m" }
        return "\(Int(elapsed / 3600))h\(Int(elapsed.truncatingRemainder(dividingBy: 3600) / 60))m"
    }

    public var directoryName: String {
        (workingDirectory as NSString).lastPathComponent
    }

    /// True if the session is running but idle (waiting for user input)
    public var isIdle: Bool {
        status == .active && cpuPercent < 2.0
    }

    public var contextPercent: Double {
        guard maxContextTokens > 0 else { return 0 }
        return min(Double(contextTokens) / Double(maxContextTokens), 1.0)
    }

    public var maxTokensShort: String {
        guard maxContextTokens > 0 else { return "" }
        if maxContextTokens >= 1_000_000 { return "\(maxContextTokens / 1_000_000)M" }
        return "\(maxContextTokens / 1_000)K"
    }

    public var contextTokensShort: String {
        if contextTokens >= 1_000_000 { return String(format: "%.1fM", Double(contextTokens) / 1_000_000) }
        if contextTokens >= 1_000 { return "\(contextTokens / 1_000)K" }
        return "\(contextTokens)"
    }
}

public enum SessionStatus: String, Sendable {
    case active
    case waitingApproval
    case waitingAnswer
    case completed
    case error
}

public struct ApprovalRequest: Sendable {
    public let toolName: String
    public let filePath: String?
    public let input: String?
    public let diffPreview: String?
    public let receivedAt: Date

    public init(toolName: String, filePath: String?, input: String?, diffPreview: String?, receivedAt: Date = .now) {
        self.toolName = toolName
        self.filePath = filePath
        self.input = input
        self.diffPreview = diffPreview
        self.receivedAt = receivedAt
    }
}

public struct QuestionRequest: Sendable {
    public let question: String
    public let options: [String]
    public let receivedAt: Date

    public init(question: String, options: [String], receivedAt: Date = .now) {
        self.question = question
        self.options = options
        self.receivedAt = receivedAt
    }
}
