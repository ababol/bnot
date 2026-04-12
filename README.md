# Bnot

A macOS notch-panel app that monitors Claude Code sessions in real time. Lives in your MacBook's notch as a pixel-art bnot that shows context usage, session count, approval requests, and lets you jump to the exact terminal tab and pane.

Inspired by [vibeisland.app](https://vibeisland.app/).

> **Note:** Bnot is optimized for [Claude Code](https://claude.com/claude-code) running in [Ghostty](https://ghostty.org/). iTerm and Warp work but have reduced fidelity for tab/pane jumping.

## Features

- **Auto-detects all running Claude Code sessions** via process scanning and hook integration
- **Context window gauge** — battery-style fill inside the bnot character (green / yellow / red)
- **Session overview panel** — expands with smooth animation showing repo, branch, context bars, and tool activity
- **Terminal jumping** — click a session to focus the exact Ghostty tab + split pane (iTerm and Warp supported too)
- **Approval flow** — shows permission requests with diff previews, approve/deny from the notch
- **Question flow** — displays Claude's questions with clickable options
- **Session history** — resume recent sessions in a new terminal
- **Worktree support** — open GitHub PR branches in git worktrees via deep links or browser extension
- **Unique bnot per session** — deterministic pixel-art character traits (color, hat, ears) from repo + branch hash
- **Idle detection** — bnot sleeps with Zzz animation when all sessions are idle

## Tech Stack

| Layer    | Technology                              | Purpose                                                                                  |
| -------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| Frontend | React 19 + TypeScript + Tailwind CSS v4 | UI rendered in Tauri WebView                                                             |
| Native   | Tauri v2 (Rust)                         | Window management, notch detection via objc2, CGEvent keyboard injection, hover tracking |
| Backend  | Node.js sidecar (TypeScript)            | Process scanning, context estimation, session management, Unix socket server             |
| Bridge   | Rust CLI binary                         | Claude Code hook handler — reads stdin, writes to Unix socket, exits fast                |

## Architecture

```
Claude Code hooks
    |
    v
bnot-bridge (Rust CLI) ---> Unix socket ---> Node.js Sidecar
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

### Installing a Release DMG

Bnot releases are **not code-signed or notarized** yet, so macOS Gatekeeper will block the app (on macOS Sequoia you'll see _"Apple could not verify 'Bnot' is free of malware"_ with only **Move to Trash** / **Done** — right-click → Open no longer bypasses this).

> _Temporary:_ an Apple Developer account is on the way and future releases will be properly signed and notarized, so this workaround will go away.

To install:

1. Open the DMG and drag `Bnot.app` to `/Applications`.
2. Strip the quarantine attribute from a terminal:
   ```bash
   xattr -dr com.apple.quarantine /Applications/Bnot.app
   ```
3. Launch Bnot normally.

If you'd rather not run that command, build from source with `pnpm build` instead.

### Accessibility Permission

CGEvent keyboard injection (for terminal tab jumping) requires macOS Accessibility permission. The OS will prompt on first use.

## Project Structure

```
bnot/
  apps/
    desktop/                # Tauri v2 Rust core
      src/
        lib.rs              # App setup, deep-link handler
        commands.rs         # 15 Tauri IPC commands (navigation, session, approval, system)
        main.rs             # Binary entry point
        window.rs           # NSAnimationContext transitions, acceptsFirstMouse swizzle, hover watcher
        notch.rs            # NSScreen notch geometry detection
        keyboard.rs         # CGEvent injection for Ghostty tab/pane navigation
        sidecar.rs          # Node.js child process lifecycle
    web/                    # React + Tailwind frontend
      src/
        components/         # notch-content, compact-view, overview-view, session-card,
                            # history-card, settings-menu, pixel-bnot, pixel-bell,
                            # pixel-progress-bar, diff-view, status-indicator, context-menu
        context/            # SessionContext (useReducer), types, derived helpers
        hooks/              # use-tauri-events, use-timer, use-hero-session
        lib/                # colors (bnot traits), format (time/tokens), tauri (IPC wrappers)
  packages/
    sidecar/                # Node.js backend
      src/
        index.ts            # Entry point, Tauri IPC over stdin/stdout NDJSON
        ipc.ts              # NDJSON request/response router
        process-scanner.ts  # Detects Claude processes via ps, reads git info
        context-scanner.ts  # Estimates context tokens from JSONL, queries exact counts
        session-manager.ts  # Manages session state from socket messages
        socket-server.ts    # Unix domain socket server for bridge communication
        ghostty-tab-mapper.ts   # Focuses Ghostty tabs via AppleScript + TTY markers
        ghostty-focus-watcher.ts # Tracks the active Ghostty tab as hero session
        terminal-jumper.ts  # Terminal app detection and jump coordination
        history-scanner.ts  # Scans ~/.claude/projects for resumable sessions
        hook-installer.ts   # Auto-installs hooks into ~/.claude/settings.json
        repo-finder.ts      # Scans configured directories for git repos
        worktree-creator.ts # Creates git worktrees for PR branches
        session-launcher.ts # Spawns Claude Code in a new terminal
        paths.ts            # Shared path constants (CLAUDE_DIR, RUNTIME_DIR, etc.)
        terminal-utils.ts   # Shell/AppleScript string escaping
        types.ts            # Shared TypeScript types
    bridge/                 # Rust CLI hook handler
      src/
        main.rs             # user-prompt, pre-tool, post-tool, perm-request, notify, stop subcommands
        hook_input.rs       # Hook JSON deserialization
```

## How It Works

### Session Detection

Sessions are detected through two mechanisms:

1. **Process scanning** — `ProcessScanner` runs `ps` every 2 seconds to find Claude Code processes, extracts their working directory, TTY, CPU usage, and git branch via `lsof` and `git`.

2. **Hook events** — When Claude Code invokes a tool, the hook runs `bnot-bridge pre-tool` which sends the session info (tool name, file path, diff preview) to the sidecar via Unix socket.

Both sources are merged and deduplicated by the `SessionManager`.

### Context Estimation

Context token usage is estimated by reading the tail of the session's JSONL file and extracting the most recent `usage` block. A fast estimate (every 3s) uses `raw_total * 0.85`. An exact query (every 60s) runs `claude --print "/context"` for precise numbers.

### Terminal Jumping

When you click a session, Bnot focuses the correct terminal:

1. **Ghostty** — Writes a unique title marker to the session's TTY, then uses Ghostty's AppleScript API to find and focus the terminal with that title.
2. **iTerm** — Searches all windows/tabs/sessions by directory name via AppleScript.
3. **Warp** — Activates the app by bundle ID.

### Approval Flow

For dangerous tools (Bash, Edit, Write, NotebookEdit, MultiEdit), the bridge blocks on the socket with a 120s timeout, waiting for a response from the sidecar. The sidecar shows the approval UI in the notch panel, and when the user approves or denies, sends the response back through the socket. The bridge then emits Claude Code's `hookSpecificOutput` JSON (`{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}` or `"deny"`) to stdout.

## Configuration

The config file at `~/.bnot/config.json` controls which directories are scanned for git repositories (used for the worktree feature):

```json
{
  "projectDirectories": ["~/Code", "~/Projects", "~/Developer", "~/src"]
}
```

Edit via the gear icon in the overview panel or the right-click context menu on the notch.

## Browser Extension

Bnot includes an optional Chrome extension that adds an "Open in worktree" button on GitHub PR pages. It sends a `bnot://worktree?owner=...&repo=...&branch=...` deep link that the app handles to create a git worktree and open it in your terminal.

## License

[Source Available](LICENSE.md) — free to use, modify, and share. Cannot be resold or offered as a competing commercial product.
