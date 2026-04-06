import Foundation
import BuddyNotchShared

/// Scans for running Claude Code processes to detect sessions
/// even when no hooks have fired yet.
final class ProcessScanner {
    private var timer: Timer?
    private weak var sessionManager: SessionManager?
    private var knownPids: Set<Int32> = []

    init(sessionManager: SessionManager) {
        self.sessionManager = sessionManager
    }

    func start() {
        scan()
        timer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.scan()
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func scan() {
        guard let sm = sessionManager else { return }

        let activePids = findClaudeProcesses()

        // Add new sessions for pids we haven't seen
        for info in activePids {
            let sessionId = "proc-\(info.pid)"
            if sm.sessions[sessionId] == nil {
                var session = AgentSession(id: sessionId, workingDirectory: info.cwd ?? "~")
                session.terminalPid = Int(info.parentPid)
                session.terminalApp = info.terminal
                session.status = .active
                session.tty = info.tty
                session.processPid = Int(info.pid)
                sm.sessions[sessionId] = session
                if sm.heroSessionId == nil { sm.heroSessionId = sessionId }
            }
            // Update live fields (CPU, tty) but NOT lastActivity (that's for hooks/real activity)
            sm.sessions[sessionId]?.status = .active
            sm.sessions[sessionId]?.tty = info.tty
            sm.sessions[sessionId]?.processPid = Int(info.pid)
            sm.sessions[sessionId]?.cpuPercent = info.cpuPercent
        }

        let activePidSet = Set(activePids.map { "proc-\($0.pid)" })

        // Mark sessions as completed if their process is gone
        for (id, session) in sm.sessions {
            if id.hasPrefix("proc-"), !activePidSet.contains(id), session.status == .active {
                sm.sessions[id]?.status = .completed
                let removeId = id
                DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak sm] in
                    sm?.sessions.removeValue(forKey: removeId)
                }
            }
        }

        // Dedup: one session per cwd. When merging, COPY tty/processPid/cpuPercent
        // from the proc session to the surviving session.
        var seenCwds: [String: String] = [:]
        for (id, session) in sm.sessions.sorted(by: { $0.key < $1.key }) {
            let cwd = session.workingDirectory
            if let existingId = seenCwds[cwd] {
                let existingIsProc = existingId.hasPrefix("proc-")
                let newIsProc = id.hasPrefix("proc-")

                let keepId: String
                let removeId: String
                if existingIsProc && !newIsProc {
                    keepId = id
                    removeId = existingId
                } else {
                    keepId = existingId
                    removeId = id
                }

                // Copy process info from the proc session to the surviving one
                let removed = sm.sessions[removeId]
                if let tty = removed?.tty { sm.sessions[keepId]?.tty = tty }
                if let pid = removed?.processPid { sm.sessions[keepId]?.processPid = pid }
                if let cpu = removed?.cpuPercent { sm.sessions[keepId]?.cpuPercent = cpu }
                if removed?.terminalApp != nil { sm.sessions[keepId]?.terminalApp = removed?.terminalApp }

                sm.sessions.removeValue(forKey: removeId)
                seenCwds[cwd] = keepId
            } else {
                seenCwds[cwd] = id
            }
        }

        // Also push tty/processPid from proc sessions to any matching non-proc sessions
        // (for sessions that were created by hooks but later found by ProcessScanner)
        for info in activePids {
            if let matchingId = sm.sessions.first(where: {
                !$0.key.hasPrefix("proc-") && $0.value.workingDirectory == (info.cwd ?? "")
            })?.key {
                sm.sessions[matchingId]?.tty = info.tty
                sm.sessions[matchingId]?.processPid = Int(info.pid)
                sm.sessions[matchingId]?.cpuPercent = info.cpuPercent
            }
        }

        // Update hero: session with highest CPU, or most recent lastActivity
        updateHeroSession(sm: sm)
    }

    /// Set hero session to the one with the highest CPU usage (actively working).
    private func updateHeroSession(sm: SessionManager) {
        // Prefer the session currently doing work (high CPU)
        let active = sm.sessions.values.filter { $0.status == .active }
        if let busiest = active.max(by: { $0.cpuPercent < $1.cpuPercent }),
           busiest.cpuPercent > 2.0 {
            sm.heroSessionId = busiest.id
            return
        }

        // All idle — keep current hero if still valid, otherwise pick by lastActivity
        if let heroId = sm.heroSessionId, sm.sessions[heroId] != nil { return }
        if let mostRecent = sm.sessions.values.max(by: { $0.lastActivity < $1.lastActivity }) {
            sm.heroSessionId = mostRecent.id
        }
    }

    // MARK: - Process discovery

    struct ProcessInfo {
        let pid: Int32
        let parentPid: Int32
        let cwd: String?
        let terminal: String?
        let tty: String?
        let cpuPercent: Double
    }

    private func findClaudeProcesses() -> [ProcessInfo] {
        let pipe = Pipe()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        process.arguments = ["-fl", "claude"]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return []
        }

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard let output = String(data: data, encoding: .utf8) else { return [] }

        var results: [ProcessInfo] = []

        for line in output.split(separator: "\n") {
            let parts = line.split(separator: " ", maxSplits: 1)
            guard let pidStr = parts.first, let pid = Int32(pidStr) else { continue }
            let cmdLine = parts.count > 1 ? String(parts[1]) : ""

            if cmdLine.contains("BuddyBridge") || cmdLine.contains("VibeBridge") { continue }
            if cmdLine.contains("BuddyNotch") { continue }
            if cmdLine.contains("pgrep") { continue }
            if cmdLine.contains("claude-code-guide") { continue }
            if cmdLine.contains("node") && !cmdLine.contains("claude") { continue }
            if cmdLine.contains("--print") || cmdLine.contains("--output-format") { continue }
            if cmdLine.contains("--resume") && cmdLine.contains("--no-session") { continue }
            guard cmdLine.contains("claude") else { continue }

            let ppid = getParentPid(of: pid)
            let cwd = getCwd(of: pid)
            if cwd == nil || cwd == "/" { continue }

            let terminal = getTerminal(parentPid: ppid)
            let tty = getTty(of: pid)
            let cpu = getCpu(of: pid)

            results.append(ProcessInfo(pid: pid, parentPid: ppid, cwd: cwd, terminal: terminal, tty: tty, cpuPercent: cpu))
        }

        return results
    }

    // MARK: - Process info helpers

    private func getParentPid(of pid: Int32) -> Int32 {
        let pipe = Pipe()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-o", "ppid=", "-p", "\(pid)"]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        if let str = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
           let ppid = Int32(str) {
            return ppid
        }
        return 0
    }

    private func getCwd(of pid: Int32) -> String? {
        let pipe = Pipe()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        process.arguments = ["-a", "-p", "\(pid)", "-d", "cwd", "-Fn"]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        if let output = String(data: data, encoding: .utf8) {
            for line in output.split(separator: "\n") {
                if line.hasPrefix("n/") {
                    return String(line.dropFirst())
                }
            }
        }
        return nil
    }

    private func getTty(of pid: Int32) -> String? {
        let pipe = Pipe()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-o", "tty=", "-p", "\(pid)"]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        if let tty = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines), !tty.isEmpty {
            return tty
        }
        return nil
    }

    private func getCpu(of pid: Int32) -> Double {
        let pipe = Pipe()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-o", "%cpu=", "-p", "\(pid)"]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        if let str = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
           let val = Double(str) {
            return val
        }
        return 0
    }

    private func getTerminal(parentPid: Int32) -> String? {
        let pipe = Pipe()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-o", "comm=", "-p", "\(parentPid)"]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        if let comm = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) {
            if comm.contains("iTerm") { return "iTerm2" }
            if comm.contains("Terminal") { return "Terminal" }
            if comm.contains("Warp") { return "Warp" }
            if comm.contains("ghostty") || comm.contains("Ghostty") { return "Ghostty" }
            if comm.contains("Alacritty") { return "Alacritty" }
            if comm.contains("kitty") { return "Kitty" }
        }
        return nil
    }
}
