# BuddyNotch

A macOS app that turns your MacBook's notch into a real-time control surface for AI coding agents. Monitors Claude Code sessions, shows context window usage, and lets you jump to the exact terminal tab and pane.dd

Inspired by [vibeisland.app](https://vibeisland.app/).

## What It Does

BuddyNotch lives in your MacBook's notch area as a tiny pixel-art buddy character. It:

- **Detects all running Claude Code sessions** automatically via process scanning
- **Shows context window usage** as a battery-style fill inside the buddy character (green/yellow/red)
- **Displays session count** badge on the right wing of the notch
- **Expands with smooth animation** when clicked, showing all sessions with repo/branch names, context bars, and status
- **Jumps to the exact Ghostty tab + split pane** when you click a session row
- **Shows approval/question UI** for Claude Code permission requests
- **Plays 8-bit sound effects** on events
- **Sleeps with Zzz animation** when all sessions are idle

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 19 + TypeScript + Tailwind CSS v4 | UI in Tauri WebView |
| Native | Tauri v2 (Rust) | Window management, notch detection (objc2), CGEvent keyboard injection, system tray |
| Backend | Node.js sidecar (TypeScript) | Process scanning, context scanning, session management, Unix socket server |
| Bridge | Rust CLI binary | Claude Code hook handler (fire-and-forget) |

## Architecture

```
+--------------------------------------------------+
|  React + TypeScript + Tailwind (Tauri WebView)    |
|  Pixel art, session cards, approval views         |
+---------------------+----------------------------+
                      |  invoke() / events
+---------------------v----------------------------+
|  Tauri / Rust Core                                |
|  Notch geometry (objc2), CGEvent, system tray     |
+---------------------+----------------------------+
                      |  stdin/stdout NDJSON
+---------------------v----------------------------+
|  Node.js Sidecar                                  |
|  ProcessScanner, ContextScanner, SocketServer     |
+--------------------------------------------------+

+--------------------------------------------------+
|  BuddyBridge (Rust CLI)                           |
|  Claude Code hooks -> Unix socket -> Sidecar      |
+--------------------------------------------------+
```

## Build & Run

```bash
# Prerequisites
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh  # Install Rust
npm install -g pnpm                                                # Install pnpm
pnpm install                                                       # Install all deps

# Development (recommended)
pnpm dev

# Production build
pnpm build

# Format
pnpm format
```

Requires: macOS 14+, Rust toolchain, Node.js 22+, pnpm.

## Project Structure

```
buddynotch/
  apps/
    desktop/                    # Tauri Rust core
      src/
        lib.rs                  # App setup (window + sidecar + tray)
        notch.rs                # NSScreen notch detection via objc2
        window.rs               # Panel frame, animation, acceptsFirstMouse swizzle
        keyboard.rs             # CGEvent injection for tab jumping
        commands.rs             # Tauri commands
        sidecar.rs              # Node.js sidecar lifecycle + IPC
        tray.rs                 # System tray
      tauri.conf.json
      Cargo.toml
    web/                        # React + Tailwind frontend
      src/
        components/             # UI components (kebab-case)
        context/                # React Context + useReducer
        hooks/                  # useTauriEvents, useSound
        lib/                    # colors
        index.css               # Tailwind + custom @theme tokens
      index.html
      vite.config.ts
      tsconfig.json
      package.json
  packages/
    sidecar/                    # Node.js backend
      src/
        process-scanner.ts      # pgrep/ps/lsof scanning
        context-scanner.ts      # JSONL parsing + /context queries
        session-manager.ts      # Session state management
        socket-server.ts        # Unix domain socket server
        ghostty-tab-mapper.ts   # Tab/pane mapping via AppleScript
        terminal-jumper.ts      # Terminal jumping coordination
        hook-installer.ts       # Auto-install hooks to settings.json
      package.json
    bridge/                     # Rust CLI
      src/
        main.rs                 # pre-tool, post-tool, notify, stop
        hook_input.rs           # Hook JSON parsing
      Cargo.toml
  Cargo.toml                    # Rust workspace
  pnpm-workspace.yaml           # pnpm workspaces
  package.json                  # Root scripts
```

## Claude Code Hooks

Hooks are auto-installed to `~/.claude/settings.json` on app startup:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "/path/to/buddy-bridge pre-tool" }] }
    ],
    "PostToolUse": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "/path/to/buddy-bridge post-tool" }] }
    ]
  }
}
```

## Known Issues

1. **Context estimation is approximate** — Fast estimate (3s) can be off by 10-20%. Exact query runs every 60s.
2. **Ghostty tab probe briefly visible** — First click on a session row clicks through tabs to count panes (~0.3s). Cached after.
3. **Approval flow is UI-only** — The approval view renders but the bridge currently fire-and-forgets (doesn't block Claude Code).
4. **Accessibility permission required** — CGEvent injection for tab jumping requires macOS Accessibility permission.
