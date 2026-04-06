import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

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
  const repo = workingDirectory.split("/").pop() ?? "";
  const suffix = gitWorktree ?? gitBranch ?? "";
  const rand = Math.random().toString(36).slice(2, 5);
  return suffix ? `${repo}/${suffix} · ${rand}` : `${repo} · ${rand}`;
}

async function focusByTty(tty: string, label: string): Promise<boolean> {
  const marker = label;
  try {
    // Write OSC sequence to set terminal title to our marker
    await exec("/bin/sh", ["-c", `printf '\\033]0;${marker}\\007' > /dev/${tty}`]);
    // Give Ghostty a moment to process
    await new Promise((r) => setTimeout(r, 100));

    const script = `
tell application "Ghostty"
  set matches to every terminal whose name is "${marker}"
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

function escapeForAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
