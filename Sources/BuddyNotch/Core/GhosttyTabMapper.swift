import AppKit

/// Maps Ghostty child PIDs/TTYs to (tab, pane) pairs.
/// Probes tab pane counts once via AppleScript, caches the mapping.
/// Re-probes when tab count changes.
final class GhosttyTabMapper {
    struct TabPane {
        let tab: Int   // 1-based
        let pane: Int  // 0-based within tab
    }

    private var cachedMapping: [String: TabPane] = [:]  // TTY -> TabPane
    private var lastTabCount: Int = 0
    private var lastChildCount: Int = 0

    /// Get the tab+pane for a given TTY. Returns nil if not mapped yet.
    func lookup(tty: String) -> TabPane? {
        return cachedMapping[tty]
    }

    /// Refresh the mapping. Called periodically from ProcessScanner.
    /// Only re-probes if tab count or child count changed.
    func refresh(ghosttyPid: Int32) {
        let tabCount = getTabCount()
        let children = getChildrenSorted(of: ghosttyPid)

        guard tabCount > 0, !children.isEmpty else { return }

        // Only re-probe if something changed
        if tabCount == lastTabCount && children.count == lastChildCount && !cachedMapping.isEmpty {
            return
        }

        lastTabCount = tabCount
        lastChildCount = children.count

        // Probe pane counts per tab (quick AppleScript, saves+restores current tab)
        let paneCounts = probePaneCounts(tabCount: tabCount)
        guard paneCounts.count == tabCount else { return }

        // Build mapping: consume children in order, paneCount per tab
        var mapping: [String: TabPane] = [:]
        var childIdx = 0
        for (tabIdx, paneCount) in paneCounts.enumerated() {
            for paneIdx in 0..<paneCount {
                guard childIdx < children.count else { break }
                mapping[children[childIdx].tty] = TabPane(tab: tabIdx + 1, pane: paneIdx)
                childIdx += 1
            }
        }

        cachedMapping = mapping
    }

    // MARK: - Private

    private func getTabCount() -> Int {
        let script = """
        tell application "System Events"
            tell process "ghostty"
                return count of radio buttons of tab group 1 of window 1
            end tell
        end tell
        """
        let scr = NSAppleScript(source: script)
        var error: NSDictionary?
        if let result = scr?.executeAndReturnError(&error) {
            return max(0, Int(result.int32Value))
        }
        return 0
    }

    /// Probe each tab's scroll area count. Saves and restores the current tab.
    private func probePaneCounts(tabCount: Int) -> [Int] {
        // Build AppleScript that clicks each tab, counts scroll areas, restores
        var scriptLines = [
            "tell application \"System Events\"",
            "  tell process \"ghostty\"",
            "    set tg to tab group 1 of window 1",
            "    set savedTab to 0",
            "    repeat with i from 1 to count of radio buttons of tg",
            "      if value of radio button i of tg is 1 then set savedTab to i",
            "    end repeat",
            "    set counts to \"\"",
        ]

        for i in 1...tabCount {
            scriptLines += [
                "    click radio button \(i) of tg",
                "    delay 0.05",
                "    set paneCount to 0",
                "    set allE to entire contents of window 1",
                "    repeat with e in allE",
                "      if role description of e is \"scroll area\" then set paneCount to paneCount + 1",
                "    end repeat",
                "    set counts to counts & paneCount & \",\"",
            ]
        }

        scriptLines += [
            "    if savedTab > 0 then click radio button savedTab of tg",
            "    return counts",
            "  end tell",
            "end tell",
        ]

        let script = NSAppleScript(source: scriptLines.joined(separator: "\n"))
        var error: NSDictionary?
        guard let result = script?.executeAndReturnError(&error),
              let str = result.stringValue else { return [] }

        // Parse "2,1,2," -> [2, 1, 2]
        return str.split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
    }

    struct ChildInfo {
        let pid: Int32
        let tty: String
    }

    private func getChildrenSorted(of parentPid: Int32) -> [ChildInfo] {
        let pipe = Pipe()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-eo", "pid,ppid,tty"]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard let output = String(data: data, encoding: .utf8) else { return [] }

        var children: [ChildInfo] = []
        for line in output.split(separator: "\n") {
            let cols = line.split(separator: " ", omittingEmptySubsequences: true)
            guard cols.count >= 3,
                  let pid = Int32(cols[0]),
                  let ppid = Int32(cols[1]),
                  ppid == parentPid else { continue }
            let tty = String(cols[2])
            if tty != "??" && tty != "-" {
                children.append(ChildInfo(pid: pid, tty: tty))
            }
        }
        return children.sorted { $0.pid < $1.pid }
    }
}
