import { execFile } from "child_process";
import { promisify } from "util";
import { focusGhosttyTerminal } from "./ghostty-tab-mapper.js";
import { emit } from "./ipc.js";
import type { AgentSession } from "./types.js";

const exec = promisify(execFile);

export async function jumpToSession(session: AgentSession) {
  const terminal = (session.terminalApp ?? (await detectRunningTerminal())).toLowerCase();
  if (terminal.includes("ghostty")) {
    await jumpToGhostty(session);
  } else if (terminal.includes("iterm")) {
    await jumpToITerm(session);
  } else if (terminal.includes("warp")) {
    emit("tauriCommand", { method: "activate_app", params: { bundleId: "dev.warp.Warp-Stable" } });
  } else {
    await jumpToGhostty(session);
  }
}

async function jumpToGhostty(session: AgentSession) {
  // Use Ghostty's native AppleScript API to focus the terminal.
  // Pass TTY for precise matching when multiple terminals share the same directory.
  const focused = await focusGhosttyTerminal(
    session.workingDirectory,
    session.tty,
    session.gitBranch ?? undefined,
    session.gitWorktree ?? undefined,
  );
  if (!focused) {
    // Fallback: just activate Ghostty
    emit("tauriCommand", { method: "activate_app", params: { bundleId: "com.mitchellh.ghostty" } });
  }
}

async function jumpToITerm(session: AgentSession) {
  const dir = session.workingDirectory.split("/").pop() ?? "";
  const script = `
tell application "iTerm2"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if name of s contains "${dir}" then
          select t
          return
        end if
      end repeat
    end repeat
  end repeat
end tell`;

  try {
    await exec("/usr/bin/osascript", ["-e", script]);
  } catch {
    // Fallback: just activate
    emit("tauriCommand", { method: "activate_app", params: { bundleId: "com.googlecode.iterm2" } });
  }
}

/** Jump to session and type the answer (option number + Enter) */
export async function answerQuestion(session: AgentSession, optionIndex: number) {
  await jumpToSession(session);
  // Wait for terminal to focus, then type the answer
  await new Promise((r) => setTimeout(r, 300));
  const text = String(optionIndex + 1);
  try {
    await exec("/usr/bin/osascript", [
      "-e",
      `tell application "System Events" to keystroke "${text}"`,
      "-e",
      `delay 0.05`,
      "-e",
      `tell application "System Events" to keystroke return`,
    ]);
  } catch {
    // Keystroke injection failed — not critical
  }
}

export async function detectRunningTerminal(): Promise<string> {
  try {
    const { stdout } = await exec("/bin/ps", ["-eo", "comm"]);
    if (stdout.includes("ghostty")) return "ghostty";
    if (stdout.includes("iTerm")) return "iterm";
    if (stdout.includes("Warp")) return "warp";
    if (stdout.includes("Terminal")) return "terminal";
  } catch {
    // ignore
  }
  return "ghostty";
}
