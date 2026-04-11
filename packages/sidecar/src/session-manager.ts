import { execFile } from "child_process";
import { promisify } from "util";
import { emit } from "./ipc.js";
import type { AgentSession, SessionMode, SocketMessage } from "./types.js";

const exec = promisify(execFile);

const DEBOUNCE_MS = 50;
const PANEL_RESET_DELAY_MS = 6000;
const DANGEROUS_TOOLS = new Set(["Bash", "Edit", "Write", "NotebookEdit", "MultiEdit"]);

const CLAUDE_COLORS = ["green", "blue", "orange", "cyan", "purple", "pink", "yellow", "red"];

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function hashColor(id: string): string {
  return CLAUDE_COLORS[djb2(id) % CLAUDE_COLORS.length];
}

export class SessionManager {
  sessions: Record<string, AgentSession> = {};
  heroSessionId: string | null = null;
  pendingApprovalClients: Record<string, number> = {};
  coloredSessions = new Set<string>();

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  emitUpdate() {
    // Debounce: coalesce rapid updates into one event
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      emit("sessionsUpdated", {
        sessions: this.sessions,
        heroId: this.heroSessionId,
      });
    }, DEBOUNCE_MS);
  }

  handleMessage(msg: SocketMessage, clientFd: number) {
    const { type, sessionId, timestamp, payload, sessionMode } = msg;

    switch (type) {
      case "sessionStart": {
        const p = payload.sessionStart;
        if (!p) break;
        if (!this.sessions[sessionId]) {
          this.sessions[sessionId] = {
            id: sessionId,
            workingDirectory: p.workingDirectory,
            taskName: p.taskName,
            terminalApp: p.terminalApp,
            terminalPid: p.terminalPid,
            status: "active",
            startedAt: Date.now(),
            lastActivity: new Date(timestamp).getTime(),
            contextTokens: 0,
            maxContextTokens: 0,
            cpuPercent: 0,
          };
        } else {
          if (p.taskName) this.sessions[sessionId].taskName = p.taskName;
          if (p.terminalApp) this.sessions[sessionId].terminalApp = p.terminalApp;
          if (p.terminalPid) this.sessions[sessionId].terminalPid = p.terminalPid;
        }
        this.sessions[sessionId].lastActivity = new Date(timestamp).getTime();
        if (!this.heroSessionId) this.heroSessionId = sessionId;
        break;
      }

      case "preToolUse": {
        const p = payload.preToolUse;
        if (!p) break;
        this.ensureSession(sessionId, timestamp);
        this.sessions[sessionId].lastActivity = new Date(timestamp).getTime();
        this.sessions[sessionId].currentTool = p.toolName;
        this.sessions[sessionId].currentFilePath = p.filePath;

        if (p.toolName === "AskUserQuestion" && p.question) {
          this.sessions[sessionId].status = "waitingAnswer";
          this.sessions[sessionId].pendingQuestion = {
            question: p.question,
            options: p.options ?? [],
            receivedAt: Date.now(),
          };
          this.heroSessionId = sessionId;
          emit("panelStateChange", { state: "ask", sessionId });
        } else if (DANGEROUS_TOOLS.has(p.toolName) && p.blocking) {
          this.sessions[sessionId].status = "waitingApproval";
          this.sessions[sessionId].pendingApproval = {
            toolName: p.toolName,
            filePath: p.filePath,
            input: p.input,
            diffPreview: p.diffPreview,
            receivedAt: Date.now(),
          };
          this.heroSessionId = sessionId;
          emit("panelStateChange", { state: "approval", sessionId });
        } else {
          this.sessions[sessionId].status = "active";
        }
        break;
      }

      case "postToolUse": {
        this.ensureSession(sessionId, timestamp);
        this.sessions[sessionId].lastActivity = new Date(timestamp).getTime();
        this.sessions[sessionId].currentTool = undefined;
        this.sessions[sessionId].pendingApproval = undefined;
        this.sessions[sessionId].pendingQuestion = undefined;
        if (
          this.sessions[sessionId].status === "waitingApproval" ||
          this.sessions[sessionId].status === "waitingAnswer"
        ) {
          this.sessions[sessionId].status = "active";
          emit("panelStateChange", { state: "compact" });
        }
        delete this.pendingApprovalClients[sessionId];
        break;
      }

      case "notification": {
        const p = payload.notification;
        if (!p) break;
        this.ensureSession(sessionId, timestamp);
        this.sessions[sessionId].lastActivity = new Date(timestamp).getTime();

        if (p.level === "success" || p.title.toLowerCase().includes("complete")) {
          this.sessions[sessionId].status = "completed";
          this.heroSessionId = sessionId;
          emit("panelStateChange", { state: "jump", sessionId });
          setTimeout(() => {
            emit("panelStateChange", { state: "compact" });
          }, PANEL_RESET_DELAY_MS);
        }
        break;
      }

      case "sessionEnd": {
        this.ensureSession(sessionId, timestamp);
        this.sessions[sessionId].status = "completed";
        this.sessions[sessionId].lastActivity = new Date(timestamp).getTime();
        delete this.pendingApprovalClients[sessionId];

        this.heroSessionId = sessionId;
        emit("panelStateChange", { state: "jump", sessionId });

        setTimeout(() => {
          emit("panelStateChange", { state: "compact" });
          delete this.sessions[sessionId];
          this.emitUpdate();
        }, PANEL_RESET_DELAY_MS);
        break;
      }

      case "stop": {
        if (this.sessions[sessionId]) {
          this.sessions[sessionId].status = "completed";
        }
        delete this.pendingApprovalClients[sessionId];
        break;
      }

      case "heartbeat": {
        if (this.sessions[sessionId]) {
          this.sessions[sessionId].lastActivity = new Date(timestamp).getTime();
        }
        break;
      }
    }

    // Store clientFd for approval responses
    if (type === "preToolUse") {
      this.pendingApprovalClients[sessionId] = clientFd;
    }

    // Update session mode from hook event (plan mode is togglable mid-session)
    if (sessionMode && this.sessions[sessionId]) {
      const mode = sessionMode as SessionMode;
      const current = this.sessions[sessionId].sessionMode;
      // Only update if hook reports plan, or if no stronger mode is set from process scanner
      if (mode === "plan" || (current !== "dangerous" && current !== "auto")) {
        this.sessions[sessionId].sessionMode = mode;
      }
    }

    this.emitUpdate();
  }

  /**
   * Inject /color into a Claude Code session via AppleScript keystroke injection.
   * Uses TTY marker to focus the exact Ghostty tab, injects the command,
   * then returns focus to the previous app.
   */
  tryInjectColor(session: AgentSession) {
    if (this.coloredSessions.has(session.id)) return;
    this._doInjectColor(session);
  }

  private async _doInjectColor(session: AgentSession) {
    const tty = session.tty;
    if (!tty || !/^ttys\d+$/.test(tty)) return;
    if (session.terminalApp && session.terminalApp !== "Ghostty") return;

    const color = hashColor(session.workingDirectory + session.id);
    session.agentColor = color;
    this.coloredSessions.add(session.id);

    try {
      // Write OSC title marker to identify the right tab
      const { writeFile } = await import("fs/promises");
      const marker = `buddy-color-${Math.random().toString(36).slice(2, 6)}`;
      await writeFile(`/dev/${tty}`, `\x1b]0;${marker}\x07`);
      await new Promise((r) => setTimeout(r, 150));

      const script = `
tell application "System Events"
  set frontApp to name of first process whose frontmost is true
end tell
tell application "Ghostty"
  set matches to every terminal whose name is "${marker}"
  if (count of matches) > 0 then
    focus item 1 of matches
  end if
end tell
delay 0.15
tell application "System Events"
  keystroke "/color ${color}"
  keystroke return
end tell
delay 0.2
tell application frontApp
  activate
end tell`;
      await exec("/usr/bin/osascript", ["-e", script]);
    } catch {
      // Terminal injection failed — not critical
    }
  }

  private ensureSession(sessionId: string, timestamp: string) {
    if (!this.sessions[sessionId]) {
      this.sessions[sessionId] = {
        id: sessionId,
        workingDirectory: "unknown",
        status: "active",
        startedAt: Date.now(),
        lastActivity: new Date(timestamp).getTime(),
        contextTokens: 0,
        maxContextTokens: 0,
        cpuPercent: 0,
      };
      if (!this.heroSessionId) this.heroSessionId = sessionId;
    }
  }
}
