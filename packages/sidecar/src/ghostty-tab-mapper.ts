import { execFile } from "child_process";
import { writeFile } from "fs/promises";
import { promisify } from "util";
import { escapeForAppleScript } from "./terminal-utils.js";

const exec = promisify(execFile);

/**
 * Focus a Ghostty terminal by its stable UUID (captured at session start).
 */
export async function focusGhosttyById(terminalId: string): Promise<boolean> {
  const script = `tell application "Ghostty"
  activate
  repeat with w in windows
    repeat with tb in tabs of w
      repeat with t in terminals of tb
        if id of t as text is "${escapeForAppleScript(terminalId)}" then
          focus t
          return "ok"
        end if
      end repeat
    end repeat
  end repeat
  return "no match"
end tell`;
  try {
    const { stdout } = await exec("/usr/bin/osascript", ["-e", script]);
    return stdout.trim() === "ok";
  } catch {
    return false;
  }
}

/**
 * Focus a Ghostty terminal by matching its working directory.
 * Uses Ghostty's native AppleScript API (requires Ghostty 1.3.0+).
 * When a TTY is provided, uses it to precisely identify the terminal
 * (handles multiple splits/tabs with the same working directory).
 * Returns true if a matching terminal was found and focused.
 */
export async function focusGhosttyTerminal(
  workingDirectory: string,
  tty?: string,
  gitBranch?: string,
  gitWorktree?: string,
): Promise<boolean> {
  // If we have a TTY, use it for precise matching (handles splits/worktrees)
  if (tty) {
    const label = buildLabel(workingDirectory, gitBranch, gitWorktree);
    const focused = await focusByTty(tty, label);
    if (focused) return true;
  }

  // Fall back to directory-based matching
  if (await focusByDir(workingDirectory)) return true;

  // When Claude runs in a worktree (--worktree), its cwd is e.g.
  // /repo/.claude/worktrees/branch-name but the Ghostty terminal's
  // working directory is still the repo root (/repo). Fall back to that.
  const worktreeMarker = "/.claude/worktrees/";
  const idx = workingDirectory.indexOf(worktreeMarker);
  if (idx !== -1) {
    const repoRoot = workingDirectory.slice(0, idx);
    return focusByDir(repoRoot);
  }

  return false;
}

/**
 * Focus a Ghostty terminal by writing a unique title marker to its TTY,
 * then finding and focusing the terminal with that marker via AppleScript.
 */
function buildLabel(workingDirectory: string, gitBranch?: string, gitWorktree?: string): string {
  const repo = sanitize(workingDirectory.split("/").pop() ?? "");
  const suffix = sanitize(gitWorktree ?? gitBranch ?? "");
  const rand = Math.random().toString(36).slice(2, 5);
  return suffix ? `${repo}/${suffix} · ${rand}` : `${repo} · ${rand}`;
}

/** Strip shell/AppleScript metacharacters — only allow safe chars in marker */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._\-/ ]/g, "");
}

async function focusByTty(tty: string, label: string): Promise<boolean> {
  // Validate TTY format to prevent path traversal
  if (!/^ttys\d+$/.test(tty)) return false;

  try {
    await writeFile(`/dev/${tty}`, `\x1b]0;${label}\x07`);
    // Give Ghostty a moment to process
    await new Promise((r) => setTimeout(r, 100));

    const script = `
tell application "Ghostty"
  activate
  set matches to every terminal whose name is "${escapeForAppleScript(label)}"
  if (count of matches) > 0 then
    focus item 1 of matches
    return "ok"
  else
    return "no match"
  end if
end tell`;
    const { stdout } = await exec("/usr/bin/osascript", ["-e", script]);
    return stdout.trim() === "ok";
  } catch {
    return false;
  }
}

async function focusByDir(dir: string): Promise<boolean> {
  const script = `
tell application "Ghostty"
  activate
  set matches to every terminal whose working directory is "${escapeForAppleScript(dir)}"
  if (count of matches) > 0 then
    focus item 1 of matches
    return "ok"
  else
    return "no match"
  end if
end tell`;

  try {
    const { stdout } = await exec("/usr/bin/osascript", ["-e", script]);
    return stdout.trim() === "ok";
  } catch {
    return false;
  }
}
