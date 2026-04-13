import { execFile } from "child_process";
import { promisify } from "util";
import { emit } from "./ipc.js";
import type { AgentSession, SessionMode, SocketMessage } from "./types.js";

const exec = promisify(execFile);

const DEBOUNCE_MS = 50;
const COMPLETED_MIN_MS = 5000;

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
  focusedSessionId: string | null = null;
  pendingApprovalClients: Record<string, number> = {};
  coloredSessions = new Set<string>();
  private completedAt: Record<string, number> = {};

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Set status, respecting the completed-minimum hold time. */
  setStatus(sessionId: string, status: AgentSession["status"]) {
    const s = this.sessions[sessionId];
    if (!s) {
      delete this.completedAt[sessionId];
      return;
    }
    if (status !== "completed" && s.status === "completed") {
      const elapsed = Date.now() - (this.completedAt[sessionId] ?? 0);
      if (elapsed < COMPLETED_MIN_MS) return;
      delete this.completedAt[sessionId];
    }
    s.status = status;
    if (status === "completed") this.completedAt[sessionId] = Date.now();
  }

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

  /** Emit sessionsUpdated immediately, bypassing debounce.
   *  Used before panelStateChange for approval/ask to avoid race conditions. */
  flushUpdate() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    emit("sessionsUpdated", {
      sessions: this.sessions,
      heroId: this.heroSessionId,
    });
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
          // Correct the "unknown" placeholder left by ensureSession() when a hook
          // event arrived before any sessionStart (e.g., Notify/Stop).
          if (
            p.workingDirectory &&
            p.workingDirectory !== "unknown" &&
            this.sessions[sessionId].workingDirectory === "unknown"
          ) {
            this.sessions[sessionId].workingDirectory = p.workingDirectory;
          }
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
        this.sessions[sessionId].isThinking = true;

        if (p.toolName === "AskUserQuestion" && (p.question || p.questions?.length)) {
          this.setStatus(sessionId, "waitingAnswer");
          const firstQ = p.questions?.[0];
          this.sessions[sessionId].pendingQuestion = {
            question: p.question ?? firstQ?.question ?? "",
            header: p.questionHeader ?? firstQ?.questionHeader,
            options: p.options ?? firstQ?.options ?? [],
            optionDescriptions: p.optionDescriptions ?? firstQ?.optionDescriptions,
            multiSelect: p.multiSelect ?? firstQ?.multiSelect,
            allQuestions:
              p.questions && p.questions.length > 1
                ? p.questions.map((q) => ({
                    question: q.question,
                    header: q.questionHeader,
                    options: q.options ?? [],
                    optionDescriptions: q.optionDescriptions,
                    multiSelect: q.multiSelect,
                  }))
                : undefined,
            receivedAt: Date.now(),
          };
          this.heroSessionId = sessionId;
          this.flushUpdate();
          emit("panelStateChange", { state: "alert", sessionId });
        } else {
          this.setStatus(sessionId, "active");
        }
        break;
      }

      case "permissionRequest": {
        const p = payload.permissionRequest;
        if (!p) break;
        this.ensureSession(sessionId, timestamp);
        this.sessions[sessionId].lastActivity = new Date(timestamp).getTime();
        this.sessions[sessionId].currentTool = p.toolName;
        this.sessions[sessionId].currentFilePath = p.filePath;
        this.sessions[sessionId].isThinking = true;
        this.pendingApprovalClients[sessionId] = clientFd;
        this.heroSessionId = sessionId;

        // If session already has a pendingQuestion (from PreToolUse for AskUserQuestion),
        // keep it — just store the clientFd so we can send the answer back through the socket.
        if (this.sessions[sessionId].pendingQuestion) {
          this.flushUpdate();
          emit("panelStateChange", { state: "alert", sessionId });
        } else {
          this.setStatus(sessionId, "waitingApproval");
          this.sessions[sessionId].pendingApproval = {
            toolName: p.toolName,
            filePath: p.filePath,
            input: p.input,
            diffPreview: p.diffPreview,
            canRemember: p.canRemember,
            receivedAt: Date.now(),
          };
          this.flushUpdate();
          emit("panelStateChange", { state: "alert", sessionId });
        }
        break;
      }

      case "userPromptSubmit": {
        this.ensureSession(sessionId, timestamp);
        this.sessions[sessionId].lastActivity = new Date(timestamp).getTime();
        this.setStatus(sessionId, "active");
        this.sessions[sessionId].isThinking = true;
        this.heroSessionId = sessionId;
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
          this.setStatus(sessionId, "active");
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
          this.setStatus(sessionId, "completed");
          this.heroSessionId = sessionId;
          // Emit taskCompleted so the frontend can play the done sound.
          // Only fire this on genuine task completion — not on process death
          // (which is detected by the process scanner and also sets "completed").
          emit("taskCompleted", { sessionId });
        }
        break;
      }

      case "sessionEnd": {
        // Claude Code's `Stop` hook fires at the end of every assistant turn,
        // not at session end. Don't mark completed or delete — Claude is still
        // running and awaiting the next prompt. True session death is detected
        // by the process scanner's kill(pid,0) orphan sweep.
        this.ensureSession(sessionId, timestamp);
        this.sessions[sessionId].isThinking = false;
        this.sessions[sessionId].currentTool = undefined;
        this.sessions[sessionId].lastActivity = new Date(timestamp).getTime();
        delete this.pendingApprovalClients[sessionId];
        break;
      }

      case "stop": {
        if (this.sessions[sessionId]) {
          this.sessions[sessionId].isThinking = false;
          this.setStatus(sessionId, "completed");
        }
        delete this.pendingApprovalClients[sessionId];
        break;
      }

      case "stopFailure": {
        if (this.sessions[sessionId]) {
          this.sessions[sessionId].isThinking = false;
          this.setStatus(sessionId, "completed");
          this.sessions[sessionId].currentTool = undefined;
        }
        delete this.pendingApprovalClients[sessionId];
        break;
      }

      case "subagentStart": {
        this.ensureSession(sessionId, timestamp);
        this.sessions[sessionId].isThinking = true;
        this.setStatus(sessionId, "active");
        break;
      }

      case "subagentStop": {
        this.ensureSession(sessionId, timestamp);
        // Parent session is still running after subagent completes
        this.sessions[sessionId].isThinking = true;
        break;
      }

      case "postToolUseFailure": {
        this.ensureSession(sessionId, timestamp);
        this.sessions[sessionId].currentTool = undefined;
        this.sessions[sessionId].pendingApproval = undefined;
        this.sessions[sessionId].pendingQuestion = undefined;
        delete this.pendingApprovalClients[sessionId];
        break;
      }

      case "permissionDenied": {
        if (this.sessions[sessionId]) {
          this.setStatus(sessionId, "active");
          this.sessions[sessionId].pendingApproval = undefined;
          this.sessions[sessionId].pendingQuestion = undefined;
          this.sessions[sessionId].isThinking = false;
        }
        delete this.pendingApprovalClients[sessionId];
        emit("panelStateChange", { state: "compact" });
        break;
      }

      case "preCompact": {
        this.ensureSession(sessionId, timestamp);
        this.sessions[sessionId].isThinking = true;
        break;
      }

      case "heartbeat": {
        if (this.sessions[sessionId]) {
          this.sessions[sessionId].lastActivity = new Date(timestamp).getTime();
        }
        break;
      }
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
   * Inject `/color <color>` for a brand-new session AND capture its Ghostty
   * terminal id. Skipped when the session already has both color and id
   * (e.g. color loaded from JSONL + id captured previously).
   */
  tryInjectColor(session: AgentSession) {
    if (this.coloredSessions.has(session.id)) return;
    if (session.agentColor && session.ghosttyTerminalId) {
      this.coloredSessions.add(session.id);
      return;
    }
    const injectColor = !session.agentColor;
    this.coloredSessions.add(session.id);
    void this._bootstrapGhostty(session, injectColor);
  }

  /**
   * Capture only the Ghostty terminal id for a session. Writes a one-shot
   * OSC-title marker to its tty, queries Ghostty for the terminal with that
   * name, reads its stable `id`, and stops — never focuses the terminal and
   * never touches frontApp. The marker lives ~60ms before the shell/Claude
   * rewrites the title; the id is stable for the lifetime of the tab.
   */
  tryCaptureTerminalId(session: AgentSession) {
    if (session.ghosttyTerminalId) return;
    void this._captureTerminalId(session);
  }

  private async _captureTerminalId(session: AgentSession) {
    const tty = session.tty;
    if (!tty || !/^ttys\d+$/.test(tty)) return;
    if (session.terminalApp && session.terminalApp !== "Ghostty") return;

    try {
      const { writeFile } = await import("fs/promises");
      const marker = `bnot-id-${Math.random().toString(36).slice(2, 6)}`;
      await writeFile(`/dev/${tty}`, `\x1b]0;${marker}\x07`);
      await new Promise((r) => setTimeout(r, 60));

      const script = `tell application "Ghostty"
  set matches to every terminal whose name is "${marker}"
  if (count of matches) > 0 then
    return id of (item 1 of matches) as text
  end if
end tell
return ""`;
      const { stdout } = await exec("/usr/bin/osascript", ["-e", script]);
      const id = stdout.trim();
      if (id) session.ghosttyTerminalId = id;
    } catch {
      // Capture failed — not critical.
    }
  }

  private async _bootstrapGhostty(session: AgentSession, injectColor: boolean) {
    const tty = session.tty;
    if (!tty || !/^ttys\d+$/.test(tty)) return;
    if (session.terminalApp && session.terminalApp !== "Ghostty") return;

    const color = injectColor ? hashColor(session.workingDirectory + session.id) : null;
    if (color) session.agentColor = color;

    try {
      const { writeFile } = await import("fs/promises");
      const marker = `bnot-id-${Math.random().toString(36).slice(2, 6)}`;
      await writeFile(`/dev/${tty}`, `\x1b]0;${marker}\x07`);
      await new Promise((r) => setTimeout(r, 60));

      const typeColor = color
        ? `tell application "System Events"
  keystroke "/color ${color}"
  delay 0.04
  key code 36
end tell
delay 0.08
`
        : "";

      const script = `
tell application "System Events"
  set frontApp to name of first process whose frontmost is true
end tell
set terminalId to ""
tell application "Ghostty"
  set matches to every terminal whose name is "${marker}"
  if (count of matches) > 0 then
    set terminalId to id of (item 1 of matches) as text
    focus item 1 of matches
  end if
end tell
delay 0.05
${typeColor}tell application frontApp
  activate
end tell
return terminalId`;
      const { stdout } = await exec("/usr/bin/osascript", ["-e", script]);
      const id = stdout.trim();
      if (id) session.ghosttyTerminalId = id;
    } catch {
      // Terminal bootstrap failed — not critical
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
