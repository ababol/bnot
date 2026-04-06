# BuddyNotch

A native macOS app that turns your MacBook's notch into a real-time control surface for AI coding agents. Monitors Claude Code sessions, shows context window usage, and lets you jump to the exact terminal tab and pane — all without leaving your editor.

Inspired by [vibeisland.app](https://vibeisland.app/).

## What It Does

BuddyNotch lives in your MacBook's notch area as a tiny pixel-art buddy character. It:

- **Detects all running Claude Code sessions** automatically via process scanning (no manual setup)
- **Shows context window usage** as a battery-style fill inside the buddy character (green/yellow/red)
- **Displays session count** badge on the right wing of the notch
- **Expands into an overview panel** when clicked, showing all sessions with repo/branch names, context bars, and status
- **Jumps to the exact Ghostty tab + split pane** when you click a session row
- **Shows a success checkmark** for 6 seconds when a session completes, clickable to jump to it
- **Plays 8-bit sound effects** on events (approval, deny, complete, alert)
- **Sleeps with Zzz animation** when all sessions are idle (CPU < 2%)

## Architecture

```
                                    +-----------------+
                                    |   BuddyNotch    |  macOS app (SwiftUI + AppKit)
                                    |  NSPanel notch   |
                                    +--------+--------+
                                             |
                              +--------------+--------------+
                              |              |              |
                     +--------+--+   +-------+------+  +---+----------+
                     |SocketServer|   |ProcessScanner|  |ContextScanner|
                     |Unix socket |   |pgrep + ps    |  |JSONL parsing |
                     +--------+--+   +-------+------+  +---+----------+
                              |              |              |
                    +---------+    +---------+     +--------+
                    |              |                |
              +-----+-----+  +----+----+    +------+-------+
              |BuddyBridge |  |claude   |    |~/.claude/    |
              |CLI (hooks) |  |processes|    |sessions/     |
              +------------+  +---------+    |projects/     |
                                             +--------------+
```

### Three SPM Targets

| Target | Type | Purpose |
|--------|------|---------|
| **BuddyNotch** | Executable | Main macOS app — NSPanel, SwiftUI views, scanners |
| **BuddyBridge** | Executable | CLI tool called by Claude Code hooks (fire-and-forget) |
| **BuddyNotchShared** | Library | Shared Codable models, constants, session types |

### Session Detection (Three Layers)

1. **ProcessScanner** (every 2s) — `pgrep claude` finds running sessions, gets PID/TTY/CWD/CPU via `ps` and `lsof`. This is the primary detection method — works even without hooks.

2. **Claude Code Hooks** (via BuddyBridge) — `PreToolUse`, `PostToolUse`, `Notification`, `Stop` hooks in `~/.claude/settings.json` call `BuddyBridge` which sends NDJSON events over a Unix socket to BuddyNotch. Currently fire-and-forget (doesn't block Claude Code). Provides tool names and file paths.

3. **ContextScanner** (every 3s + every 60s exact) — Reads `~/.claude/sessions/*.json` to find active session IDs, then reads the corresponding JSONL conversation files to extract model name, git branch, and token usage. Every 60 seconds, runs `claude --print "/context" --resume <id>` for exact token counts.

### Context Token Estimation

Getting accurate context usage is surprisingly hard:

- The API response's `usage` field reports billing tokens (`input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens`), but with prompt caching these can far exceed the model's context window (e.g., 487K for a 200K model)
- Claude Code auto-compacts conversations, dropping older messages
- The `/context` CLI command gives exact numbers but costs an API call and takes ~1s

**Current approach:** Fast estimation from API usage (every 3s) with a correction formula, overridden by exact `/context` query (every 60s). The estimation:
- If `raw_total <= max_context`: `estimated = raw_total * 0.85` (caching overhead)
- If `raw_total > max_context`: `estimated = max_context * (1/over_ratio + 0.08)` (autocompaction)

This gives ~3% accuracy vs `/context` for the calibrated sessions.

### Ghostty Tab/Pane Jumping

The hardest technical challenge. Ghostty tabs can have split panes, and there's no API to query which tab owns which TTY. The solution:

1. **GhosttyTabMapper** probes each tab's pane count via AppleScript (`entire contents of window 1`, count scroll areas). This only runs on-demand when the user clicks a row (not in background — avoids tab flickering).

2. Maps Ghostty's direct child PIDs (sorted by PID = creation order) to tabs using the probed pane counts: first N children = tab 1 (N panes), next M = tab 2 (M panes), etc.

3. Walks up the process tree from the Claude PID to find which Ghostty child owns its TTY.

4. Sends `Cmd+<tab_number>` via CGEvent to switch tabs, then `Cmd+[` (5x reset) + `Cmd+]` (Nx forward) to navigate to the correct split pane.

**Known limitation:** The pane count probe clicks through tabs briefly (< 0.3s) and restores the original tab. This only happens the first time you click a session row, or when tab/child count changes.

### NotchPanel Geometry

- Uses `NSScreen.safeAreaInsets.top` for the compact pill height (32pt on 16" MBP)
- Uses `NSScreen.auxiliaryTopLeftArea` / `auxiliaryTopRightArea` to detect notch and compute center
- Compact pill: notch width + 36pt wings on each side (buddy left, badge right)
- Expanded panel: notch width + 110pt wings, drops down from the notch top
- `NSPanel` with `.borderless` + `.nonactivatingPanel` — never steals focus
- `canBecomeKey: false`, `canBecomeMain: false`, `.accessory` activation policy (hidden from Dock)

### Pixel Buddy Character

The buddy is an 8x8 pixel-art character drawn with SwiftUI `Canvas`:

- **Active (working):** Battery-fill animation — body fills bottom-to-top based on context %. Color: green (<60%), yellow (60-85%), red (>85%). Gentle breathing bob.
- **Active (idle):** Same battery fill but with Zzz pixels floating upward. Closed eyes (horizontal line).
- **No sessions:** Dim gray buddy with Zzz animation.
- **Session completed:** Replaced by green checkmark icon for 6 seconds (clickable to jump).

## File Structure

```
Package.swift
Sources/
  BuddyNotchShared/
    Constants.swift          # Socket path (~/.buddy-notch/buddy.sock), runtime dir
    HookEvent.swift          # SocketMessage, MessagePayload, all Codable payloads
    Session.swift            # AgentSession model, SessionStatus, ApprovalRequest, etc.
  BuddyNotch/
    App/
      main.swift             # NSApplication.shared.run() entry point
      AppDelegate.swift      # Wires everything together, state change timer, click monitors
    UI/
      NotchPanel.swift       # NSPanel subclass, geometry, compact/expanded frame calculation
      NotchContentView.swift # Root SwiftUI view, state switch (compact/overview/approval/ask/jump)
      CompactView.swift      # Left wing (BuddyBattery or checkmark) + right wing (count badge)
      OverviewView.swift     # Session list with hero card, context bars, tap-to-jump
      ApprovalView.swift     # Permission request UI (currently unused — hooks are fire-and-forget)
      AskView.swift          # Question answering UI (currently unused)
      JumpView.swift         # Expanded jump view (currently unused — jump is inline in compact)
      PixelBuddy.swift       # 8x8 pixel character for OverviewView header
      PixelProgressBar.swift # Block-based progress bar for context usage
      DiffView.swift         # Colored unified diff renderer
      Styles.swift           # (placeholder)
    Core/
      SocketServer.swift     # POSIX Unix domain socket server with GCD DispatchSource
      SessionManager.swift   # @Observable state — sessions dict, hero, panel state, actions
      ProcessScanner.swift   # Polls `pgrep`/`ps`/`lsof` every 2s, dedup, hero detection
      ContextScanner.swift   # Reads JSONL files for tokens/model/branch, runs exact /context query
      GhosttyTabMapper.swift # Probes Ghostty tab pane counts, maps TTY -> (tab, pane)
      TerminalJumper.swift   # Ghostty (keyboard), iTerm2 (AppleScript), Terminal.app, Warp
      HookInstaller.swift    # Auto-writes hooks to ~/.claude/settings.json
      SoundEngine.swift      # AVAudioEngine square-wave tone generator
      GlobalHotkeys.swift    # NSEvent global monitor for Cmd+Y/N (approval), Cmd+1/2/3 (ask)
  BuddyBridge/
    BuddyBridge.swift        # ArgumentParser CLI: pre-tool, post-tool, notify, stop subcommands
    ClaudeHookInput.swift    # Parses Claude Code hook stdin JSON
```

## Build & Run

```bash
# Build (requires Xcode CommandLineTools or Xcode.app)
swift build

# Run
swift run BuddyNotch

# The app:
# 1. Hides from Dock (accessory mode)
# 2. Creates Unix socket at ~/.buddy-notch/buddy.sock
# 3. Installs hooks in ~/.claude/settings.json (if not already present)
# 4. Shows pixel buddy in the notch area
# 5. Starts scanning for claude processes
```

Binaries are at:
- `.build/debug/BuddyNotch` (or `.build/arm64-apple-macosx/debug/BuddyNotch`)
- `.build/debug/BuddyBridge`

## Claude Code Hooks Format

Hooks in `~/.claude/settings.json` use the `matcher` + `hooks` array format:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/BuddyBridge pre-tool"
          }
        ]
      }
    ]
  }
}
```

Hook stdin JSON from Claude Code:
```json
{
  "session_id": "uuid",
  "tool_name": "Edit",
  "tool_input": { "file_path": "...", "command": "...", "old_string": "...", "new_string": "..." },
  "hookEventName": "PreToolUse",
  "cwd": "/path/to/project"
}
```

## Known Issues & Limitations

1. **Context estimation is approximate** — The fast estimate (every 3s) can be off by 10-20%. Exact `/context` query runs every 60s but spawns a `claude` subprocess.

2. **Ghostty tab probe is briefly visible** — The first time you click a session row, GhosttyTabMapper clicks through tabs to count panes (~0.3s). This is cached until tab count changes.

3. **Approval flow not wired up** — The UI for approving/denying Claude Code tool use exists (ApprovalView) but the bridge currently fire-and-forgets all events. To enable blocking approval: make BuddyBridge keep the socket connection open, wait for a response, and exit with code 0 (allow) or 2 (deny).

4. **No support for non-Ghostty split panes** — iTerm2 and Terminal.app jumping matches by tab name/session name, not by split pane.

5. **Panel sometimes stuck expanded** — If state changes rapidly, the panel frame can get out of sync. The 50ms timer detects state changes and transitions, but animation timing can cause mismatches.

6. **ProcessScanner spawns many subprocesses** — Each scan runs `pgrep`, `ps`, `lsof` per session. With 5+ sessions this adds up. Could be optimized with a single `ps` call.

## Design Decisions

- **Swift Package Manager only** — No Xcode project file. Builds with `swift build`. Chose SPM over Xcode to keep it portable and avoid xcodeproj complexity.

- **Swift 5 language mode** — Uses `.swiftLanguageMode(.v5)` in Package.swift because Swift 6 strict concurrency creates too many issues with AppKit/SwiftUI interop (NSPanel, Timer, NSEvent monitors all cross isolation boundaries).

- **NSPanel over NSWindow** — Critical for non-activating behavior. The panel never steals focus from the user's editor/terminal.

- **@Observable over ObservableObject** — Uses the modern Observation framework (macOS 14+). SessionManager is the single source of truth, observed by all SwiftUI views.

- **POSIX sockets over Network.framework** — NWListener doesn't support Unix domain socket servers. The server uses raw `socket()`/`bind()`/`listen()` with GCD `DispatchSource` for non-blocking I/O.

- **Process scanning over hooks-only** — Hooks only fire on tool use. Process scanning catches sessions that are thinking, writing text, or idle. CPU % from `ps` determines if a session is actively working or idle.

- **Keyboard shortcuts over AppleScript for Ghostty** — `Cmd+N` (goto_tab) and `Cmd+]` (goto_split:next) via CGEvent are instant and don't cause UI flickering. AppleScript `click radio button` was too slow and caused visual artifacts.

- **Fire-and-forget hooks** — BuddyBridge sends events and exits immediately. Blocking hooks would freeze Claude Code while waiting for approval. The approval UI exists but isn't wired to the blocking flow yet.

## Future Ideas

- **Bidirectional approval flow** — BuddyBridge keeps socket open, waits for allow/deny response, exits with code 0 or 2
- **Multiple monitor support** — Detect which screen has the notch
- **Codex / Gemini CLI support** — Process scanner could detect other AI agents
- **Menu bar fallback** — For non-notch Macs, use a menu bar popover instead of NSPanel
- **Sound customization** — Custom sound packs, volume control
- **Electron alternative** — Could rebuild with Tauri or Electron for cross-platform (at the cost of 50MB+ RAM)
