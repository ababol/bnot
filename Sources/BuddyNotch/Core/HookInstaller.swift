import Foundation
import BuddyNotchShared

struct HookInstaller {

    func installIfNeeded() {
        installClaudeCodeHooks()
    }

    private func installClaudeCodeHooks() {
        let settingsPath = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/settings.json")

        guard FileManager.default.fileExists(atPath: settingsPath.path) else {
            print("[HookInstaller] ~/.claude/settings.json not found, skipping")
            return
        }

        guard let settingsData = try? Data(contentsOf: settingsPath),
              var settings = try? JSONSerialization.jsonObject(with: settingsData) as? [String: Any]
        else {
            print("[HookInstaller] Could not parse settings.json")
            return
        }

        // Check if already installed (new format: matcher + hooks array)
        if let hooks = settings["hooks"] as? [String: Any],
           let preToolUse = hooks["PreToolUse"] as? [[String: Any]],
           let firstEntry = preToolUse.first,
           let innerHooks = firstEntry["hooks"] as? [[String: Any]],
           innerHooks.contains(where: { ($0["command"] as? String)?.contains("BuddyBridge") == true }) {
            print("[HookInstaller] Hooks already installed")
            return
        }

        let bridgePath = findBridgePath()

        var hooks = settings["hooks"] as? [String: Any] ?? [:]

        // New format: each event has an array of {matcher, hooks} entries
        func addHook(to event: String, subcommand: String) {
            var entries = hooks[event] as? [[String: Any]] ?? []
            entries.append([
                "matcher": "",  // empty = match all tools
                "hooks": [
                    [
                        "type": "command",
                        "command": "\(bridgePath) \(subcommand)"
                    ] as [String: Any]
                ] as [[String: Any]]
            ] as [String: Any])
            hooks[event] = entries
        }

        addHook(to: "PreToolUse", subcommand: "pre-tool")
        addHook(to: "PostToolUse", subcommand: "post-tool")
        addHook(to: "Notification", subcommand: "notify")
        addHook(to: "Stop", subcommand: "stop")

        settings["hooks"] = hooks

        if let updatedData = try? JSONSerialization.data(withJSONObject: settings, options: [.prettyPrinted, .sortedKeys]) {
            try? updatedData.write(to: settingsPath)
            print("[HookInstaller] Successfully installed hooks to ~/.claude/settings.json")
        }
    }

    private func findBridgePath() -> String {
        if let mainExec = Bundle.main.executableURL {
            let bridgeURL = mainExec.deletingLastPathComponent().appendingPathComponent("BuddyBridge")
            if FileManager.default.fileExists(atPath: bridgeURL.path) {
                return bridgeURL.path
            }
        }

        let candidates = [
            "/usr/local/bin/BuddyBridge",
            FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".local/bin/BuddyBridge").path,
        ]
        for candidate in candidates {
            if FileManager.default.fileExists(atPath: candidate) {
                return candidate
            }
        }

        return "BuddyBridge"
    }
}
