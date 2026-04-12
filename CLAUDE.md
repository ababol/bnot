# CLAUDE.md — Bnot

## Build & Run

```bash
pnpm dev               # Development (Vite HMR + Rust)
pnpm build             # Production build (.app bundle)
pnpm format            # Prettier + organize imports
cargo check            # Check Rust workspace only
```

Requires: macOS 14+, Rust (rustup), Node.js 22+, pnpm.

## Project Structure

```
bnot/
  apps/
    desktop/            # Tauri v2 Rust core
      src/              # main.rs, lib.rs, commands.rs, window.rs, notch.rs, keyboard.rs, sidecar.rs
    web/                # React 19 + TypeScript + Tailwind v4 frontend
      src/
        components/     # notch-content, compact-view, overview-view, session-card, pixel-bnot, etc.
        context/        # session-context.tsx (useReducer + Context), types.ts
        hooks/          # use-tauri-events.ts, use-timer.ts, use-hero-session.ts
        lib/            # colors.ts, format.ts, tauri.ts
  packages/
    sidecar/            # Node.js sidecar (process scanning, session mgmt, socket server)
      src/              # index.ts, process-scanner.ts, context-scanner.ts, session-manager.ts,
                        # paths.ts, terminal-utils.ts, terminal-jumper.ts, ghostty-tab-mapper.ts,
                        # socket-server.ts, hook-installer.ts, history-scanner.ts, repo-finder.ts,
                        # worktree-creator.ts, session-launcher.ts, ipc.ts, types.ts
    bridge/             # Rust CLI binary (Claude Code hook handler)
      src/              # main.rs, hook_input.rs
```

## Architecture

### Data Flow

```
Claude Code hooks → bnot-bridge (Rust CLI) → Unix socket → Sidecar
Sidecar → stdout NDJSON events → Tauri Rust → app.emit() → React frontend
React → invoke() → Tauri commands → Sidecar stdin NDJSON requests
```

### Panel States

5 states managed by `SessionContext` reducer: `compact`, `alert`, `overview`, `approval`, `ask`. `alert` is a widened `compact` used to flag pending approvals/questions via the bell pixel.

State changes always go through `setPanelState(dispatch, state)` in `lib/tauri.ts`, which dispatches to React and invokes the Rust backend in one call.

### Tauri Commands (commands.rs)

- Window/navigation: `get_notch_geometry`, `set_panel_state`, `send_goto_tab`, `navigate_pane`, `activate_app`
- Session: `jump_to_session`, `resume_session`, `answer_question`
- Approval: `approve_session`, `approve_session_always`, `deny_session`, `accept_edits_session`, `bypass_permissions_session`
- System: `open_settings`, `quit_app`

### Sidecar IPC Methods (index.ts)

`getStatus`, `jumpToSession`, `answerQuestion`, `approveSession`, `approveSessionAlways`, `denySession`, `acceptEditsSession`, `bypassPermissionsSession`, `openWorktree`, `resumeSession`.

### Key Session Fields (types.ts)

`id`, `status` (active/waitingApproval/waitingAnswer/completed/error), `workingDirectory`, `contextTokens`, `maxContextTokens`, `cpuPercent`, `gitBranch?`, `gitWorktree?`, `sessionMode?` (normal/plan/auto/dangerous), `agentColor?`.

## Architecture Decisions

**DO use LogicalPosition/LogicalSize for Tauri window positioning** — Retina 2x displays halve PhysicalPosition values.

**DO use NSAnimationContext for panel transitions** — `window.rs::animate_frame()` with `ANIMATION_DURATION` (0.2s ease-out). Don't use Tauri's `set_position`/`set_size` for state transitions (no animation).

**DO swizzle `acceptsFirstMouse:` on the webview** — Tauri's NSWindow requires focus before passing clicks. `window.rs::swizzle_accepts_first_mouse` swizzles WKWebView and its internal views to return YES.

**DO NOT use `setFloatingPanel` on Tauri windows** — Tauri's NSWindow doesn't respond to NSPanel methods. Use `msg_send!` for `setLevel`, `setCollectionBehavior`, `setHidesOnDeactivate` only.

**DO NOT update `lastActivity` in ProcessScanner** — Only hooks and initial session creation should set it.

**DO copy `tty`/`processPid`/`cpuPercent` during dedup** — Surviving session must have process info or tab jumping won't work.

**DO use Ghostty's native AppleScript API** for terminal focus — `ghostty-tab-mapper.ts` uses `focus` command + TTY marker. CGEvent/Accessibility approaches are too slow.

**DO make sidecar spawning non-fatal** — If node/npx isn't found, the app still renders without session data.

**DO use `pnpm dev` for development** — Runs `tauri dev` from root which starts Vite dev server + Rust build. The raw debug binary doesn't properly serve the embedded frontend.

## Shared Utilities

**`lib/tauri.ts`** — `setPanelState()` and `jumpToSession()`. All panel state changes must use `setPanelState` to keep React and Rust in sync.

**`lib/format.ts`** — `formatElapsed()`, `formatIdle()`, `formatRelativeTime()`, `shortenPath()`, `tokenShort()`. All time/path/token formatting lives here.

**`lib/colors.ts`** — `sessionStatusColor()` maps status+cpu to BnotColor. `parseBnotColor()` validates strings from the backend. `bnotTraitsFromId()` generates deterministic bnot appearance from hash.

**`context/types.ts`** — `directoryName()`, `isIdle()`, `projectName()`, `contextPercent()`. Derived helpers for session data.

**`packages/sidecar/src/paths.ts`** — `CLAUDE_DIR`, `RUNTIME_DIR`, `CONFIG_PATH`, `SOCKET_PATH`, `PID_PATH`. All shared paths.

**`packages/sidecar/src/terminal-utils.ts`** — `escapeForAppleScript()`, `escapeShell()`. All string escaping for shell/AppleScript.

## Tailwind CSS v4

- Plugin: `@tailwindcss/vite` in `apps/web/vite.config.ts`
- CSS entry: `apps/web/src/index.css` with `@import "tailwindcss"` + `@theme` block
- Custom tokens: `--color-bnot-green`, `--color-surface`, `--color-text-dim`, etc.
- Do NOT add `* { margin: 0; padding: 0; }` outside Tailwind layers — it overrides utility classes.

## TypeScript

- Strict mode with `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`
- Target: ES2021, JSX: react-jsx, module resolution: bundler
- Reducer exhaustiveness enforced via `satisfies never`

## IPC Protocol

Tauri <-> Sidecar via stdin/stdout NDJSON:

```
Tauri -> Sidecar:  {"id":1, "method":"jumpToSession", "params":{"sessionId":"proc-123"}}
Sidecar -> Tauri:  {"event":"sessionsUpdated", "data":{"sessions":{...}, "heroId":"proc-123"}}
Sidecar -> Tauri:  {"event":"tauriCommand", "data":{"method":"activate_app", "params":{...}}}
```

`tauriCommand` events are handled in Rust (keyboard injection, app activation) — not forwarded to the frontend.

## Claude Code Hooks

Auto-installed to `~/.claude/settings.json` on startup via `hook-installer.ts`. Bridge binary reads hook JSON from stdin, sends NDJSON to `~/.bnot/bnot.sock`, exits 0.

For dangerous tools (Bash, Edit, Write, NotebookEdit, MultiEdit), bridge blocks and waits for approval response from sidecar (120s timeout). For safe tools, it's fire-and-forget.

## Context Token Estimation

Fast path (3s): `raw_total * ESTIMATION_RATIO` or `max_context * fillPercent` for autocompacted sessions.
Exact query (60s): `claude --print "/context" --resume <id>`.

Constants in `context-scanner.ts`: `ESTIMATION_RATIO=0.85`, `OVER_RATIO_OFFSET=0.08`, `MIN_FILL_PERCENT=0.3`, `MAX_FILL_PERCENT=0.7`.

## Runtime Files

- `~/.bnot/bnot.sock` — Unix domain socket (sidecar <-> bridge)
- `~/.bnot/bnot.pid` — PID file
- `~/.bnot/config.json` — Project directories config
- `~/.claude/settings.json` — Claude Code hooks
- `~/.claude/sessions/*.json` — Session metadata
- `~/.claude/projects/<key>/<sessionId>.jsonl` — Conversation data

## Testing

```bash
# Send a fake hook event
echo '{"session_id":"test","tool_name":"Edit","tool_input":{"file_path":"test.ts"},"hookEventName":"PreToolUse","cwd":"/tmp"}' | ./target/debug/bnot-bridge pre-tool

# Test socket directly (requires app running)
node -e "
const net = require('net');
const sock = net.createConnection(process.env.HOME + '/.bnot/bnot.sock', () => {
  sock.write(JSON.stringify({type:'sessionStart',sessionId:'test',timestamp:new Date().toISOString(),payload:{sessionStart:{workingDirectory:'/tmp'}}}) + '\n');
  setTimeout(() => sock.end(), 200);
});
"
```
