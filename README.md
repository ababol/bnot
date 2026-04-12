# BuddyNotch

A macOS notch-panel app that monitors Claude Code sessions in real time. Lives in your MacBook's notch as a pixel-art buddy that shows context usage, session count, approval requests, and lets you jump to the exact terminal tab and pane.

Inspired by [vibeisland.app](https://vibeisland.app/).

https://github.com/user-attachments/assets/placeholder

## Features

- **Auto-detects all running Claude Code sessions** via process scanning and hook integration
- **Context window gauge** — battery-style fill inside the buddy character (green / yellow / red)
- **Session overview panel** — expands with smooth animation showing repo, branch, context bars, and tool activity
- **Terminal jumping** — click a session to focus the exact Ghostty tab + split pane (iTerm and Warp supported too)
- **Approval flow** — shows permission requests with diff previews, approve/deny from the notch
- **Question flow** — displays Claude's questions with clickable options
- **Session history** — resume recent sessions in a new terminal
- **Worktree support** — open GitHub PR branches in git worktrees via deep links or browser extension
- **Unique buddy per session** — deterministic pixel-art character traits (color, hat, ears) from repo + branch hash
- **Idle detection** — buddy sleeps with Zzz animation when all sessions are idle

## Tech Stack

| Layer    | Technology                              | Purpose                                                                               |
| -------- | --------------------------------------- | ------------------------------------------------------------------------------------- |
| Frontend | React 19 + TypeScript + Tailwind CSS v4 | UI rendered in Tauri WebView                                                          |
| Native   | Tauri v2 (Rust)                         | Window management, notch detection via objc2, CGEvent keyboard injection, system tray |
| Backend  | Node.js sidecar (TypeScript)            | Process scanning, context estimation, session management, Unix socket server          |
| Bridge   | Rust CLI binary                         | Claude Code hook handler — reads stdin, writes to Unix socket, exits fast             |

## Architecture

```
Claude Code hooks
    |
    v
buddy-bridge (Rust CLI) ---> Unix socket ---> Node.js Sidecar
                                                  |
                                              stdin/stdout NDJSON
                                                  |
                                                  v
                                          Tauri Rust Core
                                          (window, keyboard, tray)
                                                  |
                                              emit() / invoke()
                                                  |
                                                  v
                                          React + Tailwind UI
                                          (pixel art, session cards)
```

**Sidecar** runs `ProcessScanner` (ps-based detection), `ContextScanner` (JSONL parsing + exact `/context` queries), `SessionManager` (state machine), and `SocketServer` (receives hook events from bridge).

**Bridge** is invoked by Claude Code hooks on every tool use. For dangerous tools (Bash, Edit, Write), it blocks and waits for an approval response. For safe tools, it fires and forgets.

## Getting Started

### Prerequisites

- macOS 14+
- [Rust](https://rustup.rs/)
- Node.js 22+
- pnpm (`npm install -g pnpm`)

### Development

```bash
pnpm install
pnpm dev
```

This runs `tauri dev`, which starts the Vite dev server with HMR and builds the Rust backend. The app will appear in your notch area.

### Production Build

```bash
pnpm build
```

Produces a `.app` bundle in `apps/desktop/target/release/bundle/`.

### Accessibility Permission

CGEvent keyboard injection (for terminal tab jumping) requires macOS Accessibility permission. The OS will prompt on first use.

## Project Structure

```
buddynotch/
  apps/
    desktop/                # Tauri v2 Rust core
      src/
        lib.rs              # App setup, deep-link handler
        commands.rs         # 9 Tauri IPC commands
        window.rs           # NSAnimationContext transitions, acceptsFirstMouse swizzle
        notch.rs            # NSScreen notch geometry detection
        keyboard.rs         # CGEvent injection for Ghostty tab/pane navigation
        sidecar.rs          # Node.js child process lifecycle
        tray.rs             # System tray menu + pixel-art icon
    web/                    # React + Tailwind frontend
      src/
        components/         # compact-view, overview-view, session-card, approval-view,
                            # ask-view, jump-view, pixel-buddy, pixel-progress-bar, diff-view
        context/            # SessionContext (useReducer), types, derived helpers
        hooks/              # use-tauri-events, use-timer, use-hero-session
        lib/                # colors (buddy traits), format (time/tokens), tauri (IPC wrappers)
  packages/
    sidecar/                # Node.js backend
      src/
        process-scanner.ts  # Detects Claude processes via ps, reads git info
        context-scanner.ts  # Estimates context tokens from JSONL, queries exact counts
        session-manager.ts  # Manages session state from socket messages
        socket-server.ts    # Unix domain socket server for bridge communication
        ghostty-tab-mapper.ts  # Focuses terminals via AppleScript + TTY markers
        terminal-jumper.ts  # Terminal app detection and jump coordination
        history-scanner.ts  # Scans ~/.claude/projects for resumable sessions
        hook-installer.ts   # Auto-installs hooks into ~/.claude/settings.json
        paths.ts            # Shared path constants (CLAUDE_DIR, RUNTIME_DIR, etc.)
        terminal-utils.ts   # Shell/AppleScript string escaping
    bridge/                 # Rust CLI hook handler
      src/
        main.rs             # pre-tool, post-tool, notify, stop subcommands
        hook_input.rs       # Hook JSON deserialization
```

## How It Works

### Session Detection

Sessions are detected through two mechanisms:

1. **Process scanning** — `ProcessScanner` runs `ps` every 2 seconds to find Claude Code processes, extracts their working directory, TTY, CPU usage, and git branch via `lsof` and `git`.

2. **Hook events** — When Claude Code invokes a tool, the hook runs `buddy-bridge pre-tool` which sends the session info (tool name, file path, diff preview) to the sidecar via Unix socket.

Both sources are merged and deduplicated by the `SessionManager`.

### Context Estimation

Context token usage is estimated by reading the tail of the session's JSONL file and extracting the most recent `usage` block. A fast estimate (every 3s) uses `raw_total * 0.85`. An exact query (every 60s) runs `claude --print "/context"` for precise numbers.

### Terminal Jumping

When you click a session, BuddyNotch focuses the correct terminal:

1. **Ghostty** — Writes a unique title marker to the session's TTY, then uses Ghostty's AppleScript API to find and focus the terminal with that title.
2. **iTerm** — Searches all windows/tabs/sessions by directory name via AppleScript.
3. **Warp** — Activates the app by bundle ID.

### Approval Flow

For dangerous tools (Bash, Edit, Write, NotebookEdit, MultiEdit), the bridge blocks and waits for a response from the sidecar. The sidecar shows the approval UI in the notch panel, and when the user approves or denies, sends the response back through the socket. The bridge then prints `{"decision":"allow"}` or `{"decision":"deny"}` to stdout for Claude Code to consume.

## Configuration

The config file at `~/.buddy-notch/config.json` controls which directories are scanned for git repositories (used for the worktree feature):

```json
{
  "projectDirectories": ["~/Code", "~/Projects", "~/Developer", "~/src"]
}
```

Edit via the system tray menu (Settings...) or directly.

## Browser Extension

BuddyNotch includes an optional Chrome extension that adds an "Open in worktree" button on GitHub PR pages. It sends a `buddynotch://worktree?owner=...&repo=...&branch=...` deep link that the app handles to create a git worktree and open it in your terminal.

## License

[Source Available](LICENSE.md) — free to use, modify, and share. Cannot be resold or offered as a competing commercial product.
