import { execFile } from "child_process";
import { promisify } from "util";
import type { SessionManager } from "./session-manager.js";

const exec = promisify(execFile);

const POLL_INTERVAL_MS = 1000;

// Returns the currently-focused Ghostty terminal as "<id>|<workingDirectory>".
// Empty when Ghostty isn't frontmost / no match. Uses the same
// `focused terminal of selected tab` path as the bridge for consistent IDs.
const SCRIPT = `tell application "System Events"
  set frontApp to name of first process whose frontmost is true
end tell
if frontApp is not "ghostty" and frontApp is not "Ghostty" then
  return ""
end if
tell application "Ghostty"
  try
    set t to focused terminal of selected tab of front window
    return (id of t as text) & "|" & (working directory of t as text)
  end try
end tell
return ""`;

export class GhosttyFocusWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private sm: SessionManager;
  private inFlight = false;

  constructor(sm: SessionManager) {
    this.sm = sm;
  }

  start() {
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private async poll() {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const { stdout } = await exec("/usr/bin/osascript", ["-e", SCRIPT], { timeout: 2000 });
      const out = stdout.trim();
      const sep = out.indexOf("|");
      const terminalId = sep >= 0 ? out.slice(0, sep) : "";
      const wd = sep >= 0 ? out.slice(sep + 1) : "";

      let matchId: string | null = null;
      if (terminalId) {
        for (const [id, s] of Object.entries(this.sm.sessions)) {
          if (s.ghosttyTerminalId === terminalId) {
            matchId = id;
            break;
          }
        }
      }
      // Fall back to cwd only if no id match (sessions without a captured id yet).
      // Also capture the terminal ID so future lookups use the fast ID path.
      if (!matchId && wd && terminalId) {
        for (const [id, s] of Object.entries(this.sm.sessions)) {
          if (!s.ghosttyTerminalId && s.workingDirectory === wd) {
            s.ghosttyTerminalId = terminalId;
            matchId = id;
            break;
          }
        }
      }

      if (matchId !== this.sm.focusedSessionId) {
        this.sm.focusedSessionId = matchId;
        if (matchId && this.sm.heroSessionId !== matchId) {
          this.sm.heroSessionId = matchId;
          this.sm.emitUpdate();
        }
      }
    } catch {
      // osascript timeout / permissions / Ghostty not running — ignore.
    } finally {
      this.inFlight = false;
    }
  }
}
