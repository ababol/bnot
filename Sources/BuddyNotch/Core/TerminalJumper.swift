import AppKit
import BuddyNotchShared
import Carbon

enum TerminalJumper {
    /// Shared mapper — refreshed by ProcessScanner
    static let ghosttyMapper = GhosttyTabMapper()

    static func jump(to session: AgentSession) {
        let terminal = session.terminalApp?.lowercased() ?? detectRunningTerminal()

        if terminal.contains("ghostty") {
            jumpToGhostty(session: session)
        } else if terminal.contains("iterm") {
            jumpToITermTab(session: session)
        } else if terminal.contains("warp") {
            activateApp(bundleId: "dev.warp.Warp-Stable")
        } else {
            jumpToGhostty(session: session)
        }
    }

    // MARK: - Ghostty

    private static func jumpToGhostty(session: AgentSession) {
        guard let tty = session.tty else {
            activateApp(bundleId: "com.mitchellh.ghostty")
            return
        }

        // Probe mapping on-demand (only clicks through tabs if cache is stale)
        let ghosttyPid = findGhosttyPid()
        if ghosttyPid > 0 {
            ghosttyMapper.refresh(ghosttyPid: ghosttyPid)
        }

        guard let mapping = ghosttyMapper.lookup(tty: tty) else {
            activateApp(bundleId: "com.mitchellh.ghostty")
            return
        }

        activateApp(bundleId: "com.mitchellh.ghostty")

        // Send Cmd+<tab_number> to switch tab
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            sendGotoTab(mapping.tab)

            // Navigate to the right pane: reset to first (Cmd+[ x5) then forward (Cmd+] x paneIndex)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                for _ in 0..<5 {
                    sendKey(kVK_ANSI_LeftBracket, flags: .maskCommand)
                }
                for _ in 0..<mapping.pane {
                    sendKey(kVK_ANSI_RightBracket, flags: .maskCommand)
                }
            }
        }
    }

    // MARK: - Keyboard

    private static func sendGotoTab(_ tab: Int) {
        guard tab >= 1, tab <= 9 else { return }
        let keys = [kVK_ANSI_1, kVK_ANSI_2, kVK_ANSI_3, kVK_ANSI_4, kVK_ANSI_5,
                    kVK_ANSI_6, kVK_ANSI_7, kVK_ANSI_8, kVK_ANSI_9]
        sendKey(keys[tab - 1], flags: .maskCommand)
    }

    private static func sendKey(_ keyCode: Int, flags: CGEventFlags) {
        guard let source = CGEventSource(stateID: .hidSystemState) else { return }
        let down = CGEvent(keyboardEventSource: source, virtualKey: UInt16(keyCode), keyDown: true)
        down?.flags = flags
        down?.post(tap: .cghidEventTap)
        let up = CGEvent(keyboardEventSource: source, virtualKey: UInt16(keyCode), keyDown: false)
        up?.flags = flags
        up?.post(tap: .cghidEventTap)
    }

    // MARK: - iTerm2

    private static func jumpToITermTab(session: AgentSession) {
        let dir = session.directoryName
        let script = """
        tell application "iTerm2"
            activate
            repeat with w in windows
                repeat with t in tabs of w
                    repeat with s in sessions of t
                        if name of s contains "\(dir)" then
                            select t
                            return
                        end if
                    end repeat
                end repeat
            end repeat
        end tell
        """
        runAppleScript(script)
    }

    private static func findGhosttyPid() -> Int32 {
        let pipe = Pipe()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-eo", "pid,comm"]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard let output = String(data: data, encoding: .utf8) else { return 0 }
        for line in output.split(separator: "\n") {
            let cols = line.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true)
            guard cols.count == 2, let pid = Int32(cols[0].trimmingCharacters(in: .whitespaces)) else { continue }
            if cols[1].trimmingCharacters(in: .whitespaces).hasSuffix("/ghostty") { return pid }
        }
        return 0
    }

    // MARK: - Helpers

    @discardableResult
    private static func activateApp(bundleId: String) -> Bool {
        if let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first {
            app.activate(options: [.activateAllWindows])
            return true
        }
        return false
    }

    private static func detectRunningTerminal() -> String {
        for (bid, name) in [("com.mitchellh.ghostty", "ghostty"), ("com.googlecode.iterm2", "iterm"),
                             ("com.apple.Terminal", "terminal"), ("dev.warp.Warp-Stable", "warp")] {
            if !NSRunningApplication.runningApplications(withBundleIdentifier: bid).isEmpty { return name }
        }
        return "ghostty"
    }

    @discardableResult
    private static func runAppleScript(_ source: String) -> Bool {
        let s = NSAppleScript(source: source)
        var e: NSDictionary?
        let r = s?.executeAndReturnError(&e)
        return r?.booleanValue ?? false
    }
}
