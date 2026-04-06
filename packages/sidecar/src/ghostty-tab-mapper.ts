import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

/**
 * Focus a Ghostty terminal by matching its working directory.
 * Uses Ghostty's native AppleScript API (requires Ghostty 1.3.0+).
 * Returns true if a matching terminal was found and focused.
 */
export async function focusGhosttyTerminal(workingDirectory: string): Promise<boolean> {
  const script = `
tell application "Ghostty"
  set matches to every terminal whose working directory is "${escapeForAppleScript(workingDirectory)}"
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
