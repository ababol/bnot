import { execFile } from "child_process";
import { promisify } from "util";
import { escapeForAppleScript } from "./terminal-utils.js";

const exec = promisify(execFile);

const SETTINGS_URLS = {
  Accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  Automation: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
} as const;

export async function notifyUser(title: string, body: string): Promise<void> {
  const script = `display notification "${escapeForAppleScript(body)}" with title "${escapeForAppleScript(title)}"`;
  try {
    await exec("/usr/bin/osascript", ["-e", script]);
  } catch (e) {
    process.stderr.write(`[notify] failed: ${e}\n`);
  }
}

/**
 * Persistent permission alert with an "Open Settings" button that deep-links
 * to the right Privacy pane. Uses `display dialog` (stays until dismissed)
 * via System Events so it appears as a real macOS dialog rather than an
 * osascript-owned alert. Returns nothing — fire-and-forget.
 */
export async function notifyPermissionRequired(
  pane: keyof typeof SETTINGS_URLS,
  body: string,
): Promise<void> {
  const title = `Bnot needs ${pane} permission`;
  const script = `tell application "System Events"
  activate
  set theResult to display dialog "${escapeForAppleScript(body)}" ¬
    with title "${escapeForAppleScript(title)}" ¬
    buttons {"Cancel", "Open Settings"} ¬
    default button "Open Settings" ¬
    with icon caution ¬
    giving up after 30
  if gave up of theResult then return ""
  return button returned of theResult
end tell`;
  try {
    const { stdout } = await exec("/usr/bin/osascript", ["-e", script]);
    if (stdout.trim() === "Open Settings") {
      await exec("/usr/bin/open", [SETTINGS_URLS[pane]]);
    }
  } catch (e) {
    process.stderr.write(`[notify] permission dialog failed: ${e}\n`);
  }
}
