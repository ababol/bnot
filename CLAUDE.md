# CLAUDE.md — BuddyNotch

## Project Overview

BuddyNotch is a macOS notch-panel app that monitors Claude Code sessions. It lives in the MacBook notch area as a pixel-art buddy character that shows context usage, session count, and lets you jump to specific terminal tabs/panes.

Built with Tauri v2 (Rust) + React 19 + TypeScript + Tailwind CSS v4 + Node.js sidecar.

## Build & Run

```bash
pnpm dev               # Development (Vite HMR + Rust)
pnpm build             # Production build (.app bundle)
pnpm format            # Prettier + organize imports
cargo check            # Check Rust workspace only
```

Requires: macOS 14+, Rust (rustup), Node.js 22+, pnpm.

## Project Structure

Monorepo with pnpm workspaces:

```
buddynotch/
  apps/
    desktop/            # Tauri Rust core (window, keyboard, notch detection)
      src/              # lib.rs, commands.rs, window.rs, notch.rs, keyboard.rs, sidecar.rs, tray.rs
      tauri.conf.json
      Cargo.toml
    web/                # React + TypeScript + Tailwind frontend
      src/
        components/     # notch-content, compact-view, overview-view, session-card, etc.
        context/        # session-context.tsx (useReducer), types.ts
        hooks/          # use-tauri-events.ts, use-sound.ts
        lib/            # colors.ts
      index.html
      vite.config.ts
      tsconfig.json
      package.json
  packages/
    sidecar/            # Node.js sidecar (process scanning, session mgmt, socket server)
      src/              # index.ts, process-scanner.ts, context-scanner.ts, session-manager.ts, etc.
      package.json
    bridge/             # Rust CLI binary (Claude Code hook handler)
      src/              # main.rs, hook_input.rs
      Cargo.toml
  Cargo.toml            # Rust workspace (apps/desktop + packages/bridge)
  pnpm-workspace.yaml   # pnpm workspaces (apps/*, packages/*)
  package.json          # Root scripts (pnpm dev/build/format)
```

## Architecture Decisions

**DO use LogicalPosition/LogicalSize for Tauri window positioning** — Retina 2x displays halve PhysicalPosition values.

**DO use NSAnimationContext for panel transitions** — `window.animator().setFrame()` with 0.2s ease-out in `window.rs`. Don't use Tauri's `set_position`/`set_size` for state transitions (no animation).

**DO swizzle `acceptsFirstMouse:` on the webview** — Tauri's NSWindow requires focus before passing clicks. Swizzling the content view hierarchy to return YES makes it single-click like the original NSPanel. See `window.rs::swizzle_accepts_first_mouse`.

**DO NOT use `setFloatingPanel` on Tauri windows** — Tauri's NSWindow doesn't respond to NSPanel methods. Use `msg_send!` for `setLevel`, `setCollectionBehavior`, `setHidesOnDeactivate` only.

**DO NOT update `lastActivity` in ProcessScanner** — Only hooks and initial session creation should set it.

**DO copy `tty`/`processPid`/`cpuPercent` during dedup** — Surviving session MUST have process info or tab jumping won't work.

**DO use CGEvent for Ghostty navigation** — `Cmd+N` (goto_tab) and `Cmd+]` (goto_split:next) via CGEvent. AppleScript is too slow.

**DO NOT iterate Ghostty tabs in background** — Only probe on-demand (user clicks a session row).

**DO make sidecar spawning non-fatal** — If npx/tsx isn't found, the app still renders without session data.

**DO use `pnpm dev` for development** — Runs `tauri dev` from root which starts Vite dev server + Rust build. The raw debug binary doesn't properly serve the embedded frontend.

## Tailwind CSS v4

- Plugin: `@tailwindcss/vite` in `apps/web/vite.config.ts`
- CSS entry: `apps/web/src/index.css` with `@import "tailwindcss"` + `@theme` block
- Custom tokens: `--color-buddy-green`, `--color-surface`, `--color-text-dim`, etc.
- Do NOT add `* { margin: 0; padding: 0; }` outside Tailwind layers — it overrides utility classes. Tailwind's preflight handles the reset.

## IPC Protocol

Tauri <-> Sidecar via stdin/stdout NDJSON:

```
Tauri -> Sidecar:  {"id":1, "method":"jumpToSession", "params":{"sessionId":"proc-123"}}
Sidecar -> Tauri:  {"event":"sessionsUpdated", "data":{"sessions":{...}, "heroId":"proc-123"}}
Sidecar -> Tauri:  {"event":"tauriCommand", "data":{"method":"activate_app", "params":{...}}}
```

`tauriCommand` events are handled in Rust (keyboard injection, app activation) — not forwarded to the frontend.

## Claude Code Hooks

Auto-installed to `~/.claude/settings.json` on startup via `packages/sidecar/src/hook-installer.ts`:

```json
{"matcher": "", "hooks": [{"type": "command", "command": "/path/to/buddy-bridge pre-tool"}]}
```

Bridge binary reads hook JSON from stdin, sends NDJSON to `~/.buddy-notch/buddy.sock`, exits 0.

## Context Token Estimation

Fast path (3s): `raw_total * 0.85` or `max_context * (1/over_ratio + 0.08)` for autocompacted.
Exact query (60s): `claude --print "/context" --resume <id>`.

## Runtime Files

- `~/.buddy-notch/buddy.sock` — Unix domain socket (sidecar <-> bridge)
- `~/.buddy-notch/buddy.pid` — PID file
- `~/.claude/settings.json` — Claude Code hooks
- `~/.claude/sessions/*.json` — Session metadata
- `~/.claude/projects/<key>/<sessionId>.jsonl` — Conversation data

## Testing

```bash
# Send a fake hook event
echo '{"session_id":"test","tool_name":"Edit","tool_input":{"file_path":"test.ts"},"hookEventName":"PreToolUse","cwd":"/tmp"}' | ./target/debug/buddy-bridge pre-tool

# Test socket directly (requires app running)
node -e "
const net = require('net');
const sock = net.createConnection(process.env.HOME + '/.buddy-notch/buddy.sock', () => {
  sock.write(JSON.stringify({type:'sessionStart',sessionId:'test',timestamp:new Date().toISOString(),payload:{sessionStart:{workingDirectory:'/tmp'}}}) + '\n');
  setTimeout(() => sock.end(), 200);
});
"
```
