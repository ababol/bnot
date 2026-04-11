import { execFile } from "child_process";
import { promisify } from "util";
import { detectRunningTerminal } from "./terminal-jumper.js";

const exec = promisify(execFile);

export async function resumeSession(sessionId: string, projectPath: string): Promise<void> {
  const terminal = (await detectRunningTerminal()).toLowerCase();
  const escapedPath = projectPath.replace(/'/g, "'\\''");
  const command = `cd '${escapedPath}' && claude --resume ${sessionId}`;

  if (terminal.includes("iterm")) {
    await launchInITerm(command);
  } else if (terminal.includes("ghostty")) {
    await launchInGhostty(command);
  } else {
    // Fallback: use default terminal via open
    await launchInGhostty(command);
  }
}

async function launchInITerm(command: string) {
  const escaped = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
  const escaped = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
