import Foundation

/// Model for Claude Code hook stdin JSON.
/// Claude Code sends this JSON on stdin when a hook command runs.
struct ClaudeHookInput: Codable {
    let sessionId: String?
    let hookEventName: String?
    let toolName: String?
    let toolInput: ToolInput?
    let toolResponse: ToolResponse?
    let cwd: String?
    let sessionType: String?

    struct ToolInput: Codable {
        let command: String?
        let filePath: String?
        let content: String?
        let diff: String?
        let oldString: String?
        let newString: String?

        enum CodingKeys: String, CodingKey {
            case command
            case filePath = "file_path"
            case content
            case diff
            case oldString = "old_string"
            case newString = "new_string"
        }
    }

    struct ToolResponse: Codable {
        let filePath: String?
        let success: Bool?

        enum CodingKeys: String, CodingKey {
            case filePath
            case success
        }
    }

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case hookEventName
        case toolName = "tool_name"
        case toolInput = "tool_input"
        case toolResponse = "tool_response"
        case cwd
        case sessionType = "session_type"
    }
}
