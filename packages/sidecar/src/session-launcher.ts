import { execFile } from "child_process";
import { promisify } from "util";
import { notifyPermissionRequired, notifyUser } from "./notify.js";
import { detectRunningTerminal } from "./terminal-jumper.js";
import { escapeForAppleScript, escapeShell } from "./terminal-utils.js";

const exec = promisify(execFile);

export async function resumeSession(sessionId: string, projectPath: string): Promise<void> {
  if (!isValidSessionId(sessionId)) {
    process.stderr.write(
      `[session-launcher] refused resume: invalid session id ${JSON.stringify(sessionId)}\n`,
    );
    return;
  }
  await launchCommand(
    `cd '${escapeShell(projectPath)}' && claude --resume '${escapeShell(sessionId)}'`,
  );
}

function isValidSessionId(id: string): boolean {
  return /^[a-fA-F0-9-]{8,64}$/.test(id) || /^proc-\d+$/.test(id);
}

export async function startNewSession(projectPath: string): Promise<void> {
  await launchCommand(`cd '${escapeShell(projectPath)}' && claude`);
}

async function launchCommand(command: string): Promise<void> {
  const terminal = (await detectRunningTerminal()).toLowerCase();
  if (terminal.includes("iterm")) {
    await launchInITerm(command);
  } else {
    await launchInGhostty(command);
  }
}

async function launchInITerm(command: string) {
  const escaped = escapeForAppleScript(command);
  const script = `
tell application "iTerm2"
  activate
  create window with default profile command "${escaped}"
end tell`;

  try {
    await exec("/usr/bin/osascript", ["-e", script]);
  } catch (e) {
    surfaceLaunchError(e, "iTerm");
  }
}

async function launchInGhostty(command: string) {
  const escaped = escapeForAppleScript(command);
  const script = `
tell application "Ghostty"
  activate
end tell
delay 0.3
tell application "System Events"
  tell process "Ghostty"
    keystroke "t" using command down
  end tell
end tell
delay 0.5
tell application "System Events"
  tell process "Ghostty"
    keystroke "${escaped}"
    key code 36
  end tell
end tell`;

  try {
    await exec("/usr/bin/osascript", ["-e", script]);
  } catch (e) {
    surfaceLaunchError(e, "Ghostty");
  }
}

// macOS error codes for missing Accessibility (-1719/-1743) or Automation (-1728/-600).
// Anchored with non-digit boundaries so -600 doesn't match -6000, -17190, etc.
const PERMISSION_ERROR_RE = /(?<!\d)-(?:1719|1743|1728|600)(?!\d)|not authori[zs]ed|not allowed/i;

function surfaceLaunchError(err: unknown, terminal: string): void {
  const stderr = (err as { stderr?: unknown }).stderr;
  const stderrStr = typeof stderr === "string" ? stderr : "";
  const text = err instanceof Error ? `${err.message} ${stderrStr}` : String(err);
  process.stderr.write(`[session-launcher] ${terminal} launch failed: ${text}\n`);
  if (PERMISSION_ERROR_RE.test(text)) {
    // -1728/-600 are typically Automation; -1719/-1743 are Accessibility.
    const pane = /(?<!\d)-(?:1728|600)(?!\d)/.test(text) ? "Automation" : "Accessibility";
    void notifyPermissionRequired(
      pane,
      `Grant Bnot ${pane} permission so it can drive ${terminal}, then try again.`,
    );
  } else {
    void notifyUser(`Bnot: failed to open ${terminal}`, text.slice(0, 200));
  }
}
