import { emit } from "./ipc.js";
import type { AgentSession, SessionMode, SocketMessage } from "./types.js";

export class SessionManager {
  sessions: Record<string, AgentSession> = {};
  heroSessionId: string | null = null;
  pendingApprovalClients: Record<string, number> = {};

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  emitUpdate() {
    // Debounce: coalesce rapid updates into one event
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      emit("sessionsUpdated", {
        sessions: this.sessions,
        heroId: this.heroSessionId,
      });
    }, 50);
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
        this.sessions[sessionId].status = "active";
        break;
      }

      case "postToolUse": {
        this.ensureSession(sessionId, timestamp);
        this.sessions[sessionId].lastActivity = new Date(timestamp).getTime();
        this.sessions[sessionId].currentTool = undefined;
        this.sessions[sessionId].pendingApproval = undefined;
        if (this.sessions[sessionId].status === "waitingApproval") {
          this.sessions[sessionId].status = "active";
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
          }, 6000);
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
        }, 6000);
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
