import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

const REQUIRED_HOOKS: Record<string, string> = {
  UserPromptSubmit: "user-prompt",
  PreToolUse: "pre-tool",
  PostToolUse: "post-tool",
  PermissionRequest: "perm-request",
  Notification: "notify",
  Stop: "stop",
};

type HookEntry = {
  matcher?: string;
  hooks?: Array<{ command?: string; timeout?: number; type?: string }>;
};

export async function installHooksIfNeeded(bridgePath?: string) {
  const bridge = bridgePath ?? (await findBridgePath());
  if (!bridge) {
    process.stderr.write("[hookInstaller] buddy-bridge binary not found, skipping hook install\n");
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

  const allInstalled = Object.entries(REQUIRED_HOOKS).every(([event, subcommand]) =>
    (hooks[event] ?? []).some((entry) =>
      entry.hooks?.some((h) => h.command?.includes(`buddy-bridge ${subcommand}`)),
    ),
  );
  if (allInstalled) {
    process.stderr.write("[hookInstaller] hooks already installed\n");
    return;
  }

  // Strip any existing buddy-bridge entries, then reinstall all required hooks.
  // Handles upgrades from older installs that had fewer events or stale timeouts.
  const newHooks: Record<string, HookEntry[]> = {};
  for (const [event, entries] of Object.entries(hooks)) {
    const filtered = entries.filter(
      (entry) => !entry.hooks?.some((h) => h.command?.includes("buddy-bridge")),
    );
    if (filtered.length > 0) newHooks[event] = filtered;
  }

  for (const [event, subcommand] of Object.entries(REQUIRED_HOOKS)) {
    const entries = newHooks[event] ?? [];
    entries.push({
      matcher: "",
      hooks: [{ type: "command", command: `${bridge} ${subcommand}` }],
    });
    newHooks[event] = entries;
  }

  settings.hooks = newHooks;

  try {
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
    process.stderr.write("[hookInstaller] hooks installed to ~/.claude/settings.json\n");
  } catch (e) {
    process.stderr.write(`[hookInstaller] failed to write settings: ${e}\n`);
  }
}

async function findBridgePath(): Promise<string | null> {
  const cwd = process.cwd();
  const candidates = [
    // Bundled inside .app Resources (sidecar cwd is Resources/sidecar/)
    path.resolve(cwd, "../bin/buddy-bridge"),
    path.join(os.homedir(), ".local/bin/buddy-bridge"),
    "/usr/local/bin/buddy-bridge",
    path.resolve(cwd, "target/debug/buddy-bridge"),
    path.resolve(cwd, "target/release/buddy-bridge"),
    path.resolve(cwd, "../target/debug/buddy-bridge"),
    path.resolve(cwd, "../target/release/buddy-bridge"),
    path.resolve(cwd, "../../target/debug/buddy-bridge"),
    path.resolve(cwd, "../../target/release/buddy-bridge"),
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
