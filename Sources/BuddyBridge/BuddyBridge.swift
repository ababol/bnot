import Foundation
import ArgumentParser
import BuddyNotchShared

@main
struct BuddyBridge: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "buddy-bridge",
        abstract: "Bridge between Claude Code hooks and BuddyNotch",
        subcommands: [PreTool.self, PostTool.self, Notify.self, Stop.self]
    )
}

// MARK: - Subcommands

struct PreTool: ParsableCommand {
    static let configuration = CommandConfiguration(commandName: "pre-tool")

    func run() throws {
        let hook = readHookInput()
        let sessionId = hook?.sessionId ?? UUID().uuidString

        // Send session start (idempotent — server ignores if session already exists)
        let startMsg = SocketMessage(
            type: .sessionStart,
            sessionId: sessionId,
            payload: .sessionStart(SessionStartPayload(
                taskName: nil,
                workingDirectory: hook?.cwd ?? FileManager.default.currentDirectoryPath,
                terminalApp: detectTerminal(),
                terminalPid: getParentPid()
            ))
        )
        try? sendMessage(startMsg)

        // Build diff preview from Edit tool input
        var diffPreview: String? = nil
        if let oldStr = hook?.toolInput?.oldString, let newStr = hook?.toolInput?.newString {
            diffPreview = "- \(oldStr)\n+ \(newStr)"
        } else if let diff = hook?.toolInput?.diff {
            diffPreview = diff
        }

        let message = SocketMessage(
            type: .preToolUse,
            sessionId: sessionId,
            payload: .preToolUse(PreToolUsePayload(
                toolName: hook?.toolName ?? "Tool",
                filePath: hook?.toolInput?.filePath,
                input: hook?.toolInput?.command,
                diffPreview: diffPreview
            ))
        )

        // Fire-and-forget: send event for monitoring, don't block Claude Code
        try? sendMessage(message)
    }
}

struct PostTool: ParsableCommand {
    static let configuration = CommandConfiguration(commandName: "post-tool")

    func run() throws {
        let hook = readHookInput()
        let sessionId = hook?.sessionId ?? UUID().uuidString

        // Ensure session exists
        let startMsg = SocketMessage(
            type: .sessionStart,
            sessionId: sessionId,
            payload: .sessionStart(SessionStartPayload(
                workingDirectory: hook?.cwd ?? FileManager.default.currentDirectoryPath,
                terminalApp: detectTerminal(),
                terminalPid: getParentPid()
            ))
        )
        try? sendMessage(startMsg)

        let message = SocketMessage(
            type: .postToolUse,
            sessionId: sessionId,
            payload: .postToolUse(PostToolUsePayload(
                toolName: hook?.toolName ?? "Tool",
                filePath: hook?.toolInput?.filePath ?? hook?.toolResponse?.filePath
            ))
        )
        try? sendMessage(message)
    }
}

struct Notify: ParsableCommand {
    static let configuration = CommandConfiguration(commandName: "notify")

    func run() throws {
        let hook = readHookInput()
        let sessionId = hook?.sessionId ?? UUID().uuidString

        let message = SocketMessage(
            type: .notification,
            sessionId: sessionId,
            payload: .notification(NotificationPayload(
                title: hook?.toolName ?? "Notification",
                body: hook?.cwd ?? "",
                level: .info
            ))
        )
        try? sendMessage(message)
    }
}

struct Stop: ParsableCommand {
    static let configuration = CommandConfiguration(commandName: "stop")

    func run() throws {
        let hook = readHookInput()
        let sessionId = hook?.sessionId ?? UUID().uuidString

        let message = SocketMessage(
            type: .sessionEnd,
            sessionId: sessionId,
            payload: .sessionEnd(SessionEndPayload(reason: "completed"))
        )
        try? sendMessage(message)
    }
}

// MARK: - Helpers

func readHookInput() -> ClaudeHookInput? {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard !data.isEmpty else { return nil }
    return try? JSONDecoder().decode(ClaudeHookInput.self, from: data)
}

func detectTerminal() -> String? {
    ProcessInfo.processInfo.environment["TERM_PROGRAM"]
}

/// Get the parent process PID (the terminal/shell running Claude Code)
func getParentPid() -> Int? {
    let ppid = getppid()
    return ppid > 1 ? Int(ppid) : nil
}

func connectSocket() throws -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { throw BridgeError.socketFailed }

    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let path = BuddyConstants.socketPath
    withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
        path.withCString { cstr in
            _ = memcpy(ptr, cstr, min(path.utf8.count, 103))
        }
    }

    let addrLen = socklen_t(MemoryLayout<sockaddr_un>.offset(of: \.sun_path)! + path.utf8.count + 1)
    let result = withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
            connect(fd, sockPtr, addrLen)
        }
    }

    guard result == 0 else {
        close(fd)
        throw BridgeError.connectFailed
    }

    return fd
}

func sendMessage(_ message: SocketMessage) throws {
    let fd = try connectSocket()
    defer { close(fd) }

    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    var data = try encoder.encode(message)
    data.append(0x0A)
    data.withUnsafeBytes { ptr in
        _ = write(fd, ptr.baseAddress!, data.count)
    }
}

enum BridgeError: Error {
    case socketFailed
    case connectFailed
}
