import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

// PermissionRequest must be synchronous: it blocks waiting for user approval
// and writes a decision JSON to stdout that Claude Code reads.
// All other hooks use async:true so Claude Code doesn't wait for them.
const ASYNC_HOOKS: Record<string, string> = {
  UserPromptSubmit: "user-prompt",
  PreToolUse: "pre-tool",
  PostToolUse: "post-tool",
  Notification: "notify",
  Stop: "stop",
  SessionEnd: "session-end",
  // SessionStart omitted — every other hook command sends a sessionStart
  // preamble, so the dedicated hook is redundant. It also causes Ghostty
  // to steal terminal focus (Claude Code runs SessionStart hooks during
  // compaction, which triggers a process spawn that Ghostty reads as activity).
  StopFailure: "stop-failure",
  SubagentStart: "subagent-start",
  SubagentStop: "subagent-stop",
  PostToolUseFailure: "post-tool-failure",
  PermissionDenied: "perm-denied",
  PreCompact: "pre-compact",
};
const SYNC_HOOKS: Record<string, string> = {
  PermissionRequest: "perm-request",
};
const REQUIRED_HOOKS = { ...ASYNC_HOOKS, ...SYNC_HOOKS };

type HookEntry = {
  matcher?: string;
  hooks?: Array<{ command?: string; timeout?: number; type?: string; async?: boolean }>;
};

export async function installHooksIfNeeded(bridgePath?: string) {
  const bridge = bridgePath ?? (await findBridgePath());
  if (!bridge) {
    process.stderr.write("[hookInstaller] bnot-bridge binary not found, skipping hook install\n");
    return;
  }

  let settings: Record<string, unknown>;
  try {
    const data = await fs.readFile(SETTINGS_PATH, "utf-8");
    settings = JSON.parse(data);
  } catch {
    process.stderr.write("[hookInstaller] ~/.claude/settings.json not found or invalid\n");
    return;
  }

  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;

  const allInstalled = Object.entries(REQUIRED_HOOKS).every(([event, subcommand]) => {
    const isAsync = event in ASYNC_HOOKS;
    return (hooks[event] ?? []).some((entry) =>
      entry.hooks?.some(
        (h) =>
          h.command?.includes(`bnot-bridge ${subcommand}`) &&
          (isAsync ? h.async === true : !h.async),
      ),
    );
  });
  if (allInstalled && !process.env._BNOT_FORCE_HOOK_INSTALL) {
    process.stderr.write("[hookInstaller] hooks already installed\n");
    return;
  }

  // Strip any existing bnot-bridge entries, then reinstall all required hooks.
  // Handles upgrades from older installs that had fewer events or stale timeouts.
  const newHooks: Record<string, HookEntry[]> = {};
  for (const [event, entries] of Object.entries(hooks)) {
    const filtered = entries.filter(
      (entry) => !entry.hooks?.some((h) => h.command?.includes("bnot-bridge")),
    );
    if (filtered.length > 0) newHooks[event] = filtered;
  }

  for (const [event, subcommand] of Object.entries(ASYNC_HOOKS)) {
    const entries = newHooks[event] ?? [];
    entries.push({
      matcher: "",
      hooks: [{ type: "command", command: `${bridge} ${subcommand}`, async: true }],
    });
    newHooks[event] = entries;
  }
  for (const [event, subcommand] of Object.entries(SYNC_HOOKS)) {
    const entries = newHooks[event] ?? [];
    entries.push({
      matcher: "",
      hooks: [{ type: "command", command: `${bridge} ${subcommand}` }],
    });
    newHooks[event] = entries;
  }
  settings.hooks = newHooks;

  // Disable Claude Code's terminal title so bnot markers persist for tab identification
  const env = (settings.env ?? {}) as Record<string, string>;
  env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE = "1";
  settings.env = env;

  try {
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
    process.stderr.write("[hookInstaller] hooks installed to ~/.claude/settings.json\n");
  } catch (e) {
    process.stderr.write(`[hookInstaller] failed to write settings: ${e}\n`);
  }
}

// ── Hook health check ────────────────────────────────────────────────────────

type HookHealthIssue =
  | { kind: "binaryNotFound"; searchedPaths: string[] }
  | { kind: "binaryNotExecutable"; path: string }
  | { kind: "configMalformedJSON"; path: string; error: string }
  | { kind: "hooksMissing"; events: string[] }
  | { kind: "otherHooksPresent"; commands: string[] };

type HookHealthReport = {
  status: "healthy" | "degraded";
  binaryPath: string | null;
  configPath: string;
  errors: HookHealthIssue[];
  notices: HookHealthIssue[];
};

export async function checkHookHealth(): Promise<HookHealthReport> {
  const errors: HookHealthIssue[] = [];
  const notices: HookHealthIssue[] = [];

  // 1. Resolve bridge binary
  const binaryPath = await findBridgePath();
  if (!binaryPath) {
    const cwd = process.cwd();
    errors.push({
      kind: "binaryNotFound",
      searchedPaths: [
        path.resolve(cwd, "../bin/bnot-bridge"),
        path.join(os.homedir(), ".local/bin/bnot-bridge"),
        "/usr/local/bin/bnot-bridge",
      ],
    });
  } else {
    try {
      await fs.access(binaryPath, fs.constants.X_OK);
    } catch {
      errors.push({ kind: "binaryNotExecutable", path: binaryPath });
    }
  }

  // 2. Parse settings.json
  let settings: Record<string, unknown> | null = null;
  try {
    const data = await fs.readFile(SETTINGS_PATH, "utf-8");
    settings = JSON.parse(data);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      errors.push({
        kind: "configMalformedJSON",
        path: SETTINGS_PATH,
        error: String(e),
      });
    }
    // ENOENT (file missing) is not an error — hooks haven't been installed yet
  }

  if (settings) {
    const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;

    // 3. Verify all required hooks present
    const missingEvents = Object.entries(REQUIRED_HOOKS)
      .filter(([event, subcommand]) => {
        const isAsync = event in ASYNC_HOOKS;
        return !(hooks[event] ?? []).some((entry) =>
          entry.hooks?.some(
            (h) =>
              h.command?.includes(`bnot-bridge ${subcommand}`) &&
              (isAsync ? h.async === true : !h.async),
          ),
        );
      })
      .map(([event]) => event);

    if (missingEvents.length > 0) {
      errors.push({ kind: "hooksMissing", events: missingEvents });
    }

    // 4. Collect non-bnot-bridge commands as informational notices
    const otherCommands: string[] = [];
    for (const entries of Object.values(hooks)) {
      for (const entry of entries) {
        for (const h of entry.hooks ?? []) {
          if (h.command && !h.command.includes("bnot-bridge")) {
            otherCommands.push(h.command);
          }
        }
      }
    }
    if (otherCommands.length > 0) {
      notices.push({ kind: "otherHooksPresent", commands: [...new Set(otherCommands)] });
    }
  }

  return {
    status: errors.length === 0 ? "healthy" : "degraded",
    binaryPath,
    configPath: SETTINGS_PATH,
    errors,
    notices,
  };
}

export async function repairHooks(): Promise<HookHealthReport> {
  // Force reinstall by temporarily making the "already installed" check fail.
  // The easiest way: just call installHooksIfNeeded with a fresh bridge lookup,
  // which will strip stale entries and reinstall.
  const bridge = await findBridgePath();
  if (bridge) {
    // Clear the "already installed" gate by calling with force flag via env
    process.env._BNOT_FORCE_HOOK_INSTALL = "1";
    await installHooksIfNeeded(bridge);
    delete process.env._BNOT_FORCE_HOOK_INSTALL;
  }
  return checkHookHealth();
}

// ── Status line (usage stats) ────────────────────────────────────────────────

import { RUNTIME_DIR, STATUSLINE_PATH, USAGE_PATH } from "./paths.js";

export async function installStatusLineIfNeeded(): Promise<void> {
  let settings: Record<string, unknown>;
  try {
    const data = await fs.readFile(SETTINGS_PATH, "utf-8");
    settings = JSON.parse(data);
  } catch {
    return; // settings.json missing or invalid — skip silently
  }

  const existing = (settings as Record<string, { command?: string }>).statusLine?.command;
  if (existing && !existing.includes("bnot")) {
    process.stderr.write(`[hookInstaller] statusLine already set to "${existing}", skipping\n`);
    return;
  }

  // Write the script
  const script =
    [
      "#!/bin/bash",
      "input=$(cat)",
      `echo "$input" | jq -c '{`,
      `  five_hour: (.rate_limits.five_hour // null),`,
      `  seven_day: (.rate_limits.seven_day // null),`,
      `  cached_at: (now * 1000 | floor)`,
      `}' > "${USAGE_PATH}" 2>/dev/null || true`,
      "session_id=$(echo \"$input\" | jq -r '.session_id // empty' 2>/dev/null)",
      'if [ -n "$session_id" ]; then',
      `  echo "$input" | jq -c '{`,
      `    used_percentage: (.context_window.used_percentage // null),`,
      `    context_window_size: (.context_window.context_window_size // 0),`,
      `    cached_at: (now * 1000 | floor)`,
      `  }' > "${RUNTIME_DIR}/ctx-` + "${session_id}" + `.json" 2>/dev/null || true`,
      "fi",
    ].join("\n") + "\n";

  try {
    await fs.mkdir(path.dirname(STATUSLINE_PATH), { recursive: true });
    await fs.writeFile(STATUSLINE_PATH, script, { mode: 0o755 });
  } catch (e) {
    process.stderr.write(`[hookInstaller] failed to write statusline script: ${e}\n`);
    return;
  }

  (settings as Record<string, unknown>).statusLine = {
    type: "command",
    command: STATUSLINE_PATH,
    async: true,
  };
  try {
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
    process.stderr.write("[hookInstaller] statusLine installed\n");
  } catch (e) {
    process.stderr.write(`[hookInstaller] failed to update settings for statusLine: ${e}\n`);
  }
}

// ── Private helpers ──────────────────────────────────────────────────────────

async function findBridgePath(): Promise<string | null> {
  const cwd = process.cwd();
  const candidates = [
    // Bundled inside .app Resources (sidecar cwd is Resources/sidecar/)
    path.resolve(cwd, "../bin/bnot-bridge"),
    path.join(os.homedir(), ".local/bin/bnot-bridge"),
    "/usr/local/bin/bnot-bridge",
    path.resolve(cwd, "target/debug/bnot-bridge"),
    path.resolve(cwd, "target/release/bnot-bridge"),
    path.resolve(cwd, "../target/debug/bnot-bridge"),
    path.resolve(cwd, "../target/release/bnot-bridge"),
    path.resolve(cwd, "../../target/debug/bnot-bridge"),
    path.resolve(cwd, "../../target/release/bnot-bridge"),
  ];

  for (const c of candidates) {
    try {
      await fs.access(c, fs.constants.X_OK);
      return c;
    } catch {
      // not found
    }
  }

  return null;
}
