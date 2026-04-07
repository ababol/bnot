import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

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

  // Check if already installed
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const preToolUse = hooks.PreToolUse as Array<{ hooks?: Array<{ command?: string }> }> | undefined;
  if (preToolUse?.some((entry) => entry.hooks?.some((h) => h.command?.includes("buddy-bridge")))) {
    process.stderr.write("[hookInstaller] hooks already installed\n");
    return;
  }

  // Install hooks for each event
  const newHooks: Record<string, unknown[]> = { ...hooks };

  function addHook(event: string, subcommand: string) {
    const entries = (newHooks[event] ?? []) as unknown[];
    entries.push({
      matcher: "",
      hooks: [
        {
          type: "command",
          command: `${bridge} ${subcommand}`,
        },
      ],
    });
    newHooks[event] = entries;
  }

  addHook("PreToolUse", "pre-tool");
  addHook("PostToolUse", "post-tool");
  addHook("Notification", "notify");
  addHook("Stop", "stop");

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
    // Bundled inside .app Resources
    path.resolve(cwd, "../Resources/bin/buddy-bridge"),
    path.join(os.homedir(), ".local/bin/buddy-bridge"),
    "/usr/local/bin/buddy-bridge",
    path.resolve(cwd, "target/debug/buddy-bridge"),
    path.resolve(cwd, "target/release/buddy-bridge"),
    path.resolve(cwd, "../target/debug/buddy-bridge"),
    path.resolve(cwd, "../target/release/buddy-bridge"),
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
