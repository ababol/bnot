import { execFile } from "child_process";
import { promisify } from "util";
import { GhosttyTabMapper } from "./ghostty-tab-mapper.js";
import { emit } from "./ipc.js";
import type { AgentSession } from "./types.js";

const exec = promisify(execFile);
const ghosttyMapper = new GhosttyTabMapper();

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
  const tty = session.tty;
  if (!tty) {
    emit("tauriCommand", { method: "activate_app", params: { bundleId: "com.mitchellh.ghostty" } });
    return;
  }

  // Refresh mapper
  const ghosttyPid = await findGhosttyPid();
  if (ghosttyPid > 0) {
    await ghosttyMapper.refresh(ghosttyPid);
  }

  const mapping = ghosttyMapper.lookup(tty);

  // Activate Ghostty
  emit("tauriCommand", { method: "activate_app", params: { bundleId: "com.mitchellh.ghostty" } });

  if (mapping) {
    // Wait for activation, then send keystrokes
    // These will be forwarded to Tauri commands via IPC
    setTimeout(() => {
      emit("tauriCommand", { method: "send_goto_tab", params: { tab: mapping.tab } });

      setTimeout(() => {
        emit("tauriCommand", {
          method: "navigate_pane",
          params: { resetCount: 5, forwardCount: mapping.pane },
        });
      }, 100);
    }, 50);
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

async function findGhosttyPid(): Promise<number> {
  try {
    const { stdout } = await exec("/bin/ps", ["-eo", "pid,comm"]);
    for (const line of stdout.split("\n")) {
      const cols = line.trim().split(/\s+/);
      if (cols.length >= 2 && cols[1].endsWith("/ghostty")) {
        return parseInt(cols[0]) || 0;
      }
    }
  } catch {
    // ignore
  }
  return 0;
}

async function detectRunningTerminal(): Promise<string> {
  // Check which terminal is running by looking for known processes
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
