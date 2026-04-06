# CLAUDE.md — BuddyNotch

## Project Overview

BuddyNotch is a native Swift macOS notch-panel app that monitors Claude Code sessions. It lives in the MacBook notch area as a pixel-art buddy character that shows context usage, session count, and lets you jump to specific terminal tabs/panes.

## Build

```bash
swift build              # Debug build
swift build -c release   # Release build
swift run BuddyNotch     # Run the app
```

Requires macOS 14+ and Swift 6.0 toolchain. Uses `.swiftLanguageMode(.v5)` to avoid strict concurrency issues.

## Project Structure

Three SPM targets:
- `BuddyNotchShared` — Shared models (Session, HookEvent, Constants)
- `BuddyNotch` — Main app (AppKit NSPanel + SwiftUI views + Core scanners)
- `BuddyBridge` — CLI hook binary called by Claude Code (fire-and-forget)

Key directories:
- `Sources/BuddyNotch/UI/` — All SwiftUI views (CompactView, OverviewView, etc.)
- `Sources/BuddyNotch/Core/` — Backend (ProcessScanner, ContextScanner, SocketServer, TerminalJumper, GhosttyTabMapper)
- `Sources/BuddyNotch/App/` — AppDelegate + main.swift entry point

## Architecture Decisions

**DO use `DispatchQueue.main.async` for cross-thread dispatch** — Not `Task { @MainActor in }` which causes crashes with NSHostingView layout.

**DO NOT use `@MainActor` on classes** — Causes issues with Timer callbacks, NSEvent monitors, and DispatchSource handlers in Swift 5 mode. Everything runs on main thread anyway.

**DO NOT update `lastActivity` in ProcessScanner** — Only hooks and initial session creation should set it. Updating it every scan cycle causes the session list to constantly reorder.

**DO copy `tty`/`processPid`/`cpuPercent` during dedup** — When a hook-created session and a process-created session are merged, the surviving session MUST have the process info (tty, pid, cpu) or tab jumping won't work.

**DO use CGEvent for Ghostty navigation** — `Cmd+N` (goto_tab) and `Cmd+]` (goto_split:next) via `CGEvent.post()`. AppleScript `click radio button` is too slow and causes visual flicker.

**DO NOT iterate Ghostty tabs in background** — GhosttyTabMapper probes pane counts by briefly clicking through tabs. Only do this on-demand (when user clicks a session row), never in the periodic scan.

## Claude Code Hooks

Hooks use the new `matcher` + `hooks` array format in `~/.claude/settings.json`:

```json
{"matcher": "", "hooks": [{"type": "command", "command": "/path/to/BuddyBridge pre-tool"}]}
```

Empty `matcher` = matches all tools. BuddyBridge reads hook JSON from stdin, sends NDJSON to `~/.buddy-notch/buddy.sock`, and exits immediately (exit code 0 = allow).

## Context Token Estimation

Reading exact tokens requires `claude --print "/context" --resume <id>` which is slow (~1s) and spawns a subprocess. The fast path estimates from the API usage fields in the JSONL:

- Under max context: `raw_total * 0.85`
- Over max (autocompacted): `max_context * (1/over_ratio + 0.08)`

Exact query runs every 60s and overrides the estimate.

## Ghostty Tab Jumping

The hardest part of the codebase. Key files: `GhosttyTabMapper.swift`, `TerminalJumper.swift`.

Process: find claude PID -> get TTY -> walk process tree to Ghostty child -> probe tab pane counts -> map to (tab, pane) -> send `Cmd+tab_number` then `Cmd+]` keystrokes.

The probe caches results and only re-probes when tab or child count changes.

## Session Detection

Three layers, all feeding into `SessionManager.sessions`:
1. `ProcessScanner` (2s) — `pgrep claude`, gets PID/TTY/CWD/CPU
2. `BuddyBridge` hooks — tool use events via Unix socket
3. `ContextScanner` (3s) — reads `~/.claude/sessions/*.json` + JSONL for model/branch/tokens

Sessions are deduped by working directory. Hero session = highest CPU (actively working).

## Runtime Files

- `~/.buddy-notch/buddy.sock` — Unix domain socket for BuddyBridge -> BuddyNotch IPC
- `~/.buddy-notch/buddy.pid` — PID file for the running BuddyNotch instance
- `~/.claude/settings.json` — Claude Code settings with hook entries
- `~/.claude/sessions/*.json` — Session metadata (PID, sessionId, cwd)
- `~/.claude/projects/<project-key>/<sessionId>.jsonl` — Conversation data

## Known Issues

- Panel can get stuck expanded if state changes race with animation (50ms timer catches most cases)
- Context estimation can be 10-20% off between exact queries
- Ghostty tab probe briefly flickers through tabs on first click
- `claude --print "/context"` spawns visible processes that ProcessScanner must filter out
- Session list sorted alphabetically by path — not by recency or importance

## Testing

No automated tests. Manual testing:

```bash
# Send a fake hook event to test the socket
echo '{"session_id":"test","tool_name":"Edit","tool_input":{"file_path":"test.ts"},"hookEventName":"PreToolUse","cwd":"/tmp"}' | .build/debug/BuddyBridge pre-tool

# Test socket directly
echo '{"type":"sessionStart","sessionId":"test","timestamp":"2026-04-02T12:00:00Z","payload":{"sessionStart":{"workingDirectory":"/tmp"}}}' | socat - UNIX-CONNECT:~/.buddy-notch/buddy.sock
```
