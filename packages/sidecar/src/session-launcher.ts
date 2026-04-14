import { execFile } from "child_process";
import { promisify } from "util";
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
    process.stderr.write(`[session-launcher] iTerm launch failed: ${e}\n`);
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
    process.stderr.write(`[session-launcher] Ghostty launch failed: ${e}\n`);
  }
}
