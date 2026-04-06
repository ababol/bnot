import Foundation
import BuddyNotchShared

/// Reads Claude Code session JSONL files to track context window usage and session titles.
final class ContextScanner {
    private var timer: Timer?
    private var exactTimer: Timer?
    private weak var sessionManager: SessionManager?
    private let claudeDir: URL
    /// Exact token counts from `claude --print "/context"`, keyed by session ID
    private var exactCounts: [String: (used: Int, max: Int, model: String)] = [:]
    /// Cached conversation titles, keyed by JSONL path
    private var cachedTitles: [String: String] = [:]

    init(sessionManager: SessionManager) {
        self.sessionManager = sessionManager
        self.claudeDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude")
    }

    func start() {
        scan()
        timer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            self?.scan()
        }
        // Exact context query every 60 seconds + on launch
        fetchExactContexts()
        exactTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            self?.fetchExactContexts()
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        exactTimer?.invalidate()
        exactTimer = nil
    }

    private func scan() {
        guard let sm = sessionManager else { return }

        let sessionsDir = claudeDir.appendingPathComponent("sessions")
        guard let sessionFiles = try? FileManager.default.contentsOfDirectory(
            at: sessionsDir, includingPropertiesForKeys: nil
        ) else { return }

        for file in sessionFiles where file.pathExtension == "json" {
            guard let data = try? Data(contentsOf: file),
                  let meta = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let pid = meta["pid"] as? Int,
                  let sessionId = meta["sessionId"] as? String,
                  let cwd = meta["cwd"] as? String else { continue }

            guard kill(Int32(pid), 0) == 0 else { continue }

            let projectKey = cwd.replacingOccurrences(of: "/", with: "-")
            let projectDir = claudeDir.appendingPathComponent("projects").appendingPathComponent(projectKey)
            let jsonlPath = projectDir.appendingPathComponent("\(sessionId).jsonl")
            guard FileManager.default.fileExists(atPath: jsonlPath.path) else { continue }

            let info = readSessionInfo(from: jsonlPath)

            let procId = "proc-\(pid)"
            let matchingId = sm.sessions.first(where: {
                !$0.key.hasPrefix("proc-") && $0.value.workingDirectory == cwd
            })?.key ?? procId
            let targetId = sm.sessions[matchingId] != nil ? matchingId : (sm.sessions[procId] != nil ? procId : nil)
            guard let id = targetId else { continue }

            let maxCtx = maxTokens(for: info.model ?? "")
            sm.sessions[id]?.modelName = info.model
            sm.sessions[id]?.sessionFilePath = jsonlPath.path

            // Set conversation title (repo + first prompt)
            if let title = info.title {
                sm.sessions[id]?.taskName = title
            }

            // Use exact count if available, otherwise estimation
            if let exact = exactCounts[sessionId] {
                sm.sessions[id]?.contextTokens = exact.used
                sm.sessions[id]?.maxContextTokens = exact.max
            } else {
                sm.sessions[id]?.maxContextTokens = maxCtx
                sm.sessions[id]?.contextTokens = info.estimatedContext
            }
        }
    }

    struct SessionInfo {
        var model: String?
        var estimatedContext: Int = 0
        var title: String?
    }

    private func readSessionInfo(from url: URL) -> SessionInfo {
        var info = SessionInfo()
        let path = url.path

        // Get title (cached — only read once per JSONL file)
        if let cached = cachedTitles[path] {
            info.title = cached
        } else {
            info.title = readTitle(from: url)
            if let t = info.title { cachedTitles[path] = t }
        }

        // Read last API usage for context estimation
        guard let fileHandle = try? FileHandle(forReadingFrom: url) else { return info }
        defer { try? fileHandle.close() }

        let fileSize = (try? fileHandle.seekToEnd()) ?? 0
        let readSize: UInt64 = min(fileSize, 65536)
        try? fileHandle.seek(toOffset: fileSize - readSize)
        guard let data = try? fileHandle.readToEnd(),
              let text = String(data: data, encoding: .utf8) else { return info }

        for line in text.split(separator: "\n").reversed() {
            guard let lineData = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any] else { continue }

            let msg = obj["message"] as? [String: Any]

            if info.model == nil, let model = msg?["model"] as? String {
                info.model = model
            }

            if info.estimatedContext == 0, let usage = msg?["usage"] as? [String: Any] {
                let input = usage["input_tokens"] as? Int ?? 0
                let cacheRead = usage["cache_read_input_tokens"] as? Int ?? 0
                let cacheCreate = usage["cache_creation_input_tokens"] as? Int ?? 0
                let rawTotal = input + cacheRead + cacheCreate

                if rawTotal > 0 {
                    let maxCtx = maxTokens(for: info.model ?? "")
                    if rawTotal <= maxCtx {
                        info.estimatedContext = Int(Double(rawTotal) * 0.85)
                    } else {
                        let overRatio = Double(rawTotal) / Double(maxCtx)
                        let fillPercent = max(0.30, min(0.70, 1.0 / overRatio + 0.08))
                        info.estimatedContext = Int(Double(maxCtx) * fillPercent)
                    }
                }
            }

            if info.estimatedContext > 0 && info.model != nil { break }
        }

        return info
    }

    /// Extract title as "repo/branch" from the JSONL's gitBranch field and cwd.
    private func readTitle(from url: URL) -> String? {
        guard let fileHandle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? fileHandle.close() }

        // Read last 64KB to find gitBranch (it's in recent messages)
        let fileSize = (try? fileHandle.seekToEnd()) ?? 0
        let readSize: UInt64 = min(fileSize, 65536)
        try? fileHandle.seek(toOffset: fileSize - readSize)
        guard let data = try? fileHandle.readToEnd(),
              let text = String(data: data, encoding: .utf8) else { return nil }

        // Find gitBranch from the most recent entry that has it
        for line in text.split(separator: "\n").reversed() {
            guard let lineData = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                  let branch = obj["gitBranch"] as? String, !branch.isEmpty else { continue }

            // Get repo name from cwd in the same entry
            let cwd = obj["cwd"] as? String ?? ""
            let repo = (cwd as NSString).lastPathComponent

            if repo.isEmpty { return branch }
            return "\(repo)/\(branch)"
        }

        return nil
    }

    // MARK: - Exact context via claude CLI

    private func fetchExactContexts() {
        let sessionsDir = claudeDir.appendingPathComponent("sessions")
        guard let sessionFiles = try? FileManager.default.contentsOfDirectory(
            at: sessionsDir, includingPropertiesForKeys: nil
        ) else { return }

        var sessions: [(sessionId: String, cwd: String, pid: Int)] = []
        for file in sessionFiles where file.pathExtension == "json" {
            guard let data = try? Data(contentsOf: file),
                  let meta = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let pid = meta["pid"] as? Int,
                  let sessionId = meta["sessionId"] as? String,
                  let cwd = meta["cwd"] as? String,
                  kill(Int32(pid), 0) == 0 else { continue }
            sessions.append((sessionId: sessionId, cwd: cwd, pid: pid))
        }

        for session in sessions {
            DispatchQueue.global(qos: .utility).async { [weak self] in
                self?.queryExactContext(sessionId: session.sessionId, cwd: session.cwd)
            }
        }
    }

    private func queryExactContext(sessionId: String, cwd: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["claude", "--print", "/context", "--output-format", "json",
                             "--resume", sessionId, "--no-session-persistence"]
        process.currentDirectoryURL = URL(fileURLWithPath: cwd)
        process.environment = ProcessInfo.processInfo.environment

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()
        } catch { return }

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard let output = String(data: data, encoding: .utf8),
              let jsonStart = output.firstIndex(of: "{"),
              let jsonData = String(output[jsonStart...]).data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
              let resultText = obj["result"] as? String else { return }

        let pattern = #"([\d.]+)k?\s*/\s*([\d.]+)([km])\s*tokens?\s*\((\d+)%\)"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let match = regex.firstMatch(in: resultText, range: NSRange(resultText.startIndex..., in: resultText)) else { return }

        let usedStr = (resultText as NSString).substring(with: match.range(at: 1))
        let maxStr = (resultText as NSString).substring(with: match.range(at: 2))
        let maxUnit = (resultText as NSString).substring(with: match.range(at: 3)).lowercased()

        let used = Int((Double(usedStr) ?? 0) * 1000)
        let maxTokens = Int((Double(maxStr) ?? 0) * (maxUnit == "m" ? 1_000_000 : 1_000))

        var model = ""
        let modelPattern = #"\*\*Model:\*\*\s*([\w.-]+)"#
        if let modelRegex = try? NSRegularExpression(pattern: modelPattern),
           let modelMatch = modelRegex.firstMatch(in: resultText, range: NSRange(resultText.startIndex..., in: resultText)) {
            model = (resultText as NSString).substring(with: modelMatch.range(at: 1))
        }

        guard used > 0, maxTokens > 0 else { return }

        DispatchQueue.main.async { [weak self] in
            self?.exactCounts[sessionId] = (used: used, max: maxTokens, model: model)
        }
    }

    private func maxTokens(for model: String) -> Int {
        let m = model.lowercased()
        if m.contains("opus") { return 1_000_000 }
        if m.contains("sonnet") { return 200_000 }
        if m.contains("haiku") { return 200_000 }
        return 200_000
    }
}
