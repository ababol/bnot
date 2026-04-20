import { execFile } from "child_process";
import { writeFile } from "fs/promises";
import { basename } from "path";
import { promisify } from "util";
import { emit } from "./ipc.js";
import { TranscriptWatcher } from "./transcript-watcher.js";
import type { AgentSession, MessageType, SessionMode, SocketMessage } from "./types.js";

const exec = promisify(execFile);

const DEBOUNCE_MS = 50;
const COMPLETED_MIN_MS = 5000;

/** Placeholder workingDirectory written by ensureSession() when a hook event
 *  arrives before any sessionStart. Real cwds are absolute paths, so this
 *  sentinel lets pid-identity checks know the cwd is not yet trustworthy. */
export const UNKNOWN_CWD = "unknown";

const CLAUDE_COLORS = ["green", "blue", "orange", "cyan", "purple", "pink", "yellow", "red"];

/** Hooks fired during a turn that can arrive after sessionEnd, since hooks are
 *  async and socket arrival order isn't guaranteed. Suppressed when the session
 *  is in idleSessions to avoid re-arming isThinking on a finished turn. */
const STALE_TURN_EVENTS = new Set<MessageType>([
  "preToolUse",
  "subagentStart",
  "subagentStop",
  "preCompact",
]);

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
  coloredTtys = new Set<string>();
  transcriptWatcher = new TranscriptWatcher(this);
  private completedAt: Record<string, number> = {};
  idleSessions = new Set<string>();

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

  /** Called by TranscriptWatcher when the JSONL contains an Esc-interrupt
   *  marker. PostToolUse never fires for the interrupted tool, so currentTool
   *  would otherwise stay set forever. */
  applyInterrupt(sessionId: string) {
    const s = this.sessions[sessionId];
    if (!s) return;
    if (!s.isThinking && s.currentTool === undefined) return;
    s.isThinking = false;
    s.currentTool = undefined;
    this.emitUpdate();
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
    const { type, sessionId, timestamp, payload, sessionMode, sessionType } = msg;

    // Defense-in-depth: the bridge also filters this, but it's a separate process.
    if (sessionType === "agent") return;

    if (STALE_TURN_EVENTS.has(type) && this.idleSessions.has(sessionId)) return;

    switch (type) {
      case "sessionStart": {
        const p = payload.sessionStart;
        if (!p) break;
        if (!this.sessions[sessionId]) {
          // Claude auto-compact rotates session IDs but keeps the same process alive.
          // Evict the stale entry so only the new session ID owns this terminalPid.
          if (p.terminalPid) {
            for (const [existingId, existing] of Object.entries(this.sessions)) {
              if (existingId.startsWith("proc-")) continue;
              if (existing.terminalPid === p.terminalPid) {
                if (this.heroSessionId === existingId) this.heroSessionId = sessionId;
                this.transcriptWatcher.detach(existingId);
                delete this.sessions[existingId];
                this.idleSessions.delete(existingId);
                break;
              }
            }
          }
          this.sessions[sessionId] = {
            id: sessionId,
            workingDirectory: p.workingDirectory,
            taskName: p.taskName,
            terminalApp: p.terminalApp,
            terminalPid: p.terminalPid,
            ghosttyTerminalId: p.ghosttyTerminalId,
            status: "active",
            startedAt: Date.now(),
            lastActivity: new Date(timestamp).getTime(),
            contextTokens: 0,
            maxContextTokens: 0,
            cpuPercent: 0,
          };
          // Enrich with TTY and git info (async, fire-and-forget)
          void this.enrichSession(sessionId);
        } else {
          if (p.taskName) this.sessions[sessionId].taskName = p.taskName;
          if (p.terminalApp) this.sessions[sessionId].terminalApp = p.terminalApp;
          if (p.terminalPid) this.sessions[sessionId].terminalPid = p.terminalPid;
          // Correct the UNKNOWN_CWD placeholder left by ensureSession() when a hook
          // event arrived before any sessionStart (e.g., Notify/Stop).
          if (
            p.workingDirectory &&
            p.workingDirectory !== UNKNOWN_CWD &&
            this.sessions[sessionId].workingDirectory === UNKNOWN_CWD
          ) {
            this.sessions[sessionId].workingDirectory = p.workingDirectory;
          }
        }
        if (p.transcriptPath) {
          void this.transcriptWatcher.attach(sessionId, p.transcriptPath);
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
          // preToolUse and permissionRequest fire from separate bridge processes
          // and can land in either order; AskUserQuestion only ever uses pendingQuestion.
          this.sessions[sessionId].pendingApproval = undefined;
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
        } else if (
          // Skip if a racing permissionRequest already set a pending interaction.
          !this.sessions[sessionId].pendingApproval &&
          !this.sessions[sessionId].pendingQuestion
        ) {
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

        // permissionRequest carries no option data; for AskUserQuestion we just
        // store the clientFd above and wait for preToolUse to populate the question.
        if (!this.sessions[sessionId].pendingQuestion && p.toolName !== "AskUserQuestion") {
          this.setStatus(sessionId, "waitingApproval");
          this.sessions[sessionId].pendingApproval = {
            toolName: p.toolName,
            filePath: p.filePath,
            input: p.input,
            diffPreview: p.diffPreview,
            canRemember: p.canRemember,
            receivedAt: Date.now(),
          };
        }
        this.flushUpdate();
        emit("panelStateChange", { state: "alert", sessionId });
        break;
      }

      case "userPromptSubmit": {
        this.ensureSession(sessionId, timestamp);
        this.idleSessions.delete(sessionId);
        this.sessions[sessionId].lastActivity = new Date(timestamp).getTime();
        this.sessions[sessionId].taskStartedAt = Date.now();
        this.setStatus(sessionId, "active");
        this.sessions[sessionId].isThinking = true;
        this.heroSessionId = sessionId;
        // User is typing in Ghostty right now — inject /color if not yet set
        const s = this.sessions[sessionId];
        if (s.tty) this.tryInjectColor(s);
        break;
      }

      case "postToolUse": {
        this.ensureSession(sessionId, timestamp);
        this.sessions[sessionId].lastActivity = new Date(timestamp).getTime();
        this.sessions[sessionId].currentTool = undefined;
        // Keep isThinking — Claude is generating the next tool call / response
        // until Stop fires. Clearing it here flips the hero to "idle" between
        // tools.
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
        // Don't mark completed or bump lastActivity here — Claude Code fires
        // SessionEnd for mid-session events too (compaction, prompt-input-exit,
        // /clear). Real session death is detected by the orphan sweep's
        // kill(pid,0) + comm check; that's authoritative.
        if (this.sessions[sessionId]) {
          this.sessions[sessionId].isThinking = false;
          this.sessions[sessionId].currentTool = undefined;
        }
        // Suppress STALE_TURN_EVENTS until the next userPromptSubmit clears the flag,
        // otherwise a late hook from this turn would re-arm isThinking.
        this.idleSessions.add(sessionId);
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
        // The Stop hook failed — the session did NOT cleanly stop, so don't
        // mark it completed (would also block status transitions for 5s via
        // COMPLETED_MIN_MS). Just clear in-flight thinking like sessionEnd.
        if (this.sessions[sessionId]) {
          this.sessions[sessionId].isThinking = false;
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
    this.coloredSessions.add(session.id);

    if (session.agentColor && session.ghosttyTerminalId) {
      if (session.tty) this.coloredTtys.add(session.tty);
      return;
    }

    // Skip if this TTY already has a colored session (e.g. subagent sharing parent terminal)
    const ttyAlreadyColored = !!session.tty && this.coloredTtys.has(session.tty);
    const injectColor = !session.agentColor && !ttyAlreadyColored;
    if (session.tty) this.coloredTtys.add(session.tty);
    void this._bootstrapGhostty(session, injectColor);
  }

  tryCaptureTerminalId(session: AgentSession) {
    if (session.ghosttyTerminalId) return;
    void this._bootstrapGhostty(session, false);
  }

  private async _bootstrapGhostty(session: AgentSession, injectColor: boolean) {
    const tty = session.tty;
    if (!tty || !/^ttys\d+$/.test(tty)) return;
    if (session.terminalApp && session.terminalApp !== "Ghostty") return;

    const color = injectColor ? hashColor(session.workingDirectory + session.id) : null;
    if (color) session.agentColor = color;

    try {
      // Write a stable marker to the TTY. With CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1
      // (set by hook-installer), Claude Code won't overwrite it.
      const marker = `${basename(session.workingDirectory)} · ${session.id.slice(0, 8)}`;
      await writeFile(`/dev/${tty}`, `\x1b]0;${marker}\x07`);
      await new Promise((r) => setTimeout(r, 30));

      // When injecting color: focus terminal, type /color, restore focus.
      // When only capturing ID: query Ghostty without focusing.
      const script = color
        ? `tell application "System Events"
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
delay 0.02
tell application "System Events"
  keystroke "/color ${color}"
  delay 0.02
  key code 36
end tell
delay 0.03
tell application frontApp
  activate
end tell
return terminalId`
        : `set terminalId to ""
tell application "Ghostty"
  set matches to every terminal whose name is "${marker}"
  if (count of matches) > 0 then
    set terminalId to id of (item 1 of matches) as text
  end if
end tell
return terminalId`;
      const { stdout } = await exec("/usr/bin/osascript", ["-e", script]);
      const id = stdout.trim();
      if (id) session.ghosttyTerminalId = id;
    } catch {
      // Bootstrap failed — not critical
    }
  }

  private async enrichSession(sessionId: string) {
    const session = this.sessions[sessionId];
    if (!session) return;

    const [tty, gitBranch, worktreeInfo] = await Promise.all([
      session.terminalPid ? this.lookupTty(session.terminalPid) : null,
      this.lookupGitBranch(session.workingDirectory),
      this.lookupGitWorktree(session.workingDirectory),
    ]);

    const s = this.sessions[sessionId];
    if (!s) return;
    if (tty && !s.tty) s.tty = tty;
    if (gitBranch && !s.gitBranch) s.gitBranch = gitBranch;
    if (worktreeInfo) {
      if (!s.gitWorktree) s.gitWorktree = worktreeInfo.worktree;
      if (!s.gitRepoName) s.gitRepoName = worktreeInfo.repoName;
    }
    // Inject /color + capture terminal ID as soon as TTY is available
    if (s.tty) this.tryInjectColor(s);
    this.emitUpdate();
  }

  private async lookupTty(pid: number): Promise<string | null> {
    try {
      const { stdout } = await exec("/bin/ps", ["-o", "tty=", "-p", String(pid)]);
      const tty = stdout.trim();
      return tty && tty !== "??" ? tty : null;
    } catch {
      return null;
    }
  }

  private async lookupGitBranch(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await exec("/usr/bin/git", [
        "-C",
        cwd,
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      ]);
      const branch = stdout.trim();
      return branch || null;
    } catch {
      return null;
    }
  }

  private async lookupGitWorktree(
    cwd: string,
  ): Promise<{ worktree: string; repoName: string } | null> {
    try {
      const [gitDir, commonDir] = await Promise.all([
        exec("/usr/bin/git", ["-C", cwd, "rev-parse", "--git-dir"]).then((r) => r.stdout.trim()),
        exec("/usr/bin/git", ["-C", cwd, "rev-parse", "--git-common-dir"]).then((r) =>
          r.stdout.trim(),
        ),
      ]);
      if (gitDir !== commonDir) {
        const worktree = cwd.split("/").pop() ?? cwd;
        const repoName =
          commonDir
            .replace(/\/\.git$/, "")
            .split("/")
            .pop() ?? worktree;
        return { worktree, repoName };
      }
    } catch {
      // not a git repo
    }
    return null;
  }

  /** Clean up pending approval/question when a bridge socket disconnects (e.g. Escape). */
  handleClientDisconnect(clientFd: number) {
    for (const [sessionId, fd] of Object.entries(this.pendingApprovalClients)) {
      if (fd !== clientFd) continue;
      if (!this.sessions[sessionId]) {
        delete this.pendingApprovalClients[sessionId];
        continue;
      }
      setTimeout(() => {
        if (this.pendingApprovalClients[sessionId] !== clientFd) return;
        delete this.pendingApprovalClients[sessionId];
        const s = this.sessions[sessionId];
        if (!s) return;
        if (s.pendingApproval || s.pendingQuestion) {
          s.pendingApproval = undefined;
          s.pendingQuestion = undefined;
          this.setStatus(sessionId, "active");
          this.flushUpdate();
          emit("panelStateChange", { state: "compact" });
        }
      }, 500);
    }
  }

  private ensureSession(sessionId: string, timestamp: string) {
    if (!this.sessions[sessionId]) {
      this.sessions[sessionId] = {
        id: sessionId,
        workingDirectory: UNKNOWN_CWD,
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
