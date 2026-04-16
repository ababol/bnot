<div align="center">

<img src="apps/desktop/icons/128x128@2x.png" width="96" alt="Bnot" />

# Bnot

### Claude Code, live in your notch.

**Monitor every session, approve from the notch, and jump back to the exact terminal tab — without breaking flow.**

<br />

<img src="docs/images/notch.png" width="720" alt="Bnot notch panel" />

</div>

<br />

Bnot turns your MacBook's notch into a live radar for every Claude Code session you have running. No more hunting through terminal tabs to find the agent that's waiting on you, no more missed permission prompts, no more guessing how close you are to blowing the context window. One glance — you know. One click — you're there.

<div align="center">

<img src="docs/images/overview-panel.png" width="620" alt="Bnot overview panel" />

<sub>Sessions, questions, and approvals — one click away.</sub>

</div>

## Features

- **Live session radar** — auto-detects every running Claude Code session via process scanning and hook integration. Zero setup.
- **Context window gauge** — battery-style fill inside the pixel-bnot. Green, yellow, red. You'll see the wall before you hit it.
- **One-click terminal jump** — click a session, land in the exact Ghostty tab and split pane. iTerm and Warp supported too.
- **Approve from the notch** — Claude's permission requests show up with diff previews. Approve, deny, or allow-always without leaving the notch.
- **Plan-mode aware** — sessions in plan mode show an animated `PLAN` badge, so you know when Claude is drafting vs. executing.
- **Answer questions instantly** — `AskUserQuestion` prompts render inline, with multi-select checkboxes and step-by-step flows for multi-question asks. No context switch.
- **Session overview** — repo, branch, tool activity, CPU, and context bars for every agent, all in one expandable panel.
- **Resume recent sessions** — scroll back through your session history and relaunch any of them in a new terminal.
- **Worktree-first PRs** — an optional Chrome extension adds an "Open in worktree" button on GitHub PR pages that spins up a git worktree and opens it in your terminal.
- **A bnot per session** — deterministic pixel-art character (color, hat, ears) hashed from your repo + branch, with its color auto-synced to the Claude Code tab via `/color`. The notch and your terminal match at a glance.
- **Usage & health at a glance** — settings menu surfaces your Claude 5h/7d quota with reset time, hook health with one-click repair, and a check-for-updates button.
- **Knows when to rest** — idle detection puts the bnot to sleep with a gentle Zzz animation when nothing's running.

## Built for Claude Code

> Bnot is optimized for [Claude Code](https://claude.com/claude-code) running in [Ghostty](https://ghostty.org/). iTerm and Warp work, with reduced fidelity for tab/pane jumping.

## Install

### Download the DMG

1. Download the latest `.dmg` from the [Releases page](https://github.com/ababol/bnot/releases/latest).
2. Open it and drag `Bnot.app` to `/Applications`.
3. Launch Bnot.

Bnot auto-updates in the background — new releases install on next launch, or you can trigger a check from the settings menu.

### Build from source

```bash
pnpm install
pnpm build
```

Produces a `.app` bundle in `apps/desktop/target/release/bundle/`.

### Accessibility permission

CGEvent keyboard injection (for terminal tab jumping) requires macOS Accessibility permission. The OS will prompt on first use.

## Development

```bash
pnpm install
pnpm dev
```

Requires macOS 14+, [Rust](https://rustup.rs/), Node.js 22+, and pnpm (`npm install -g pnpm`).

Tauri v2 (Rust) + React 19 + Tailwind v4 on the front, a Node.js sidecar and a small Rust CLI bridge on the back. Architecture details, IPC protocol, and internals are in [CLAUDE.md](CLAUDE.md).

## Inspiration

Bnot is inspired by [vibeisland.app](https://vibeisland.app/) — go check it out.

## License

[Source Available](LICENSE.md) — free to use, modify, and share. Cannot be resold or offered as a competing commercial product.
