import { execFile } from "child_process";
import { basename } from "path";
import { promisify } from "util";
import { UNKNOWN_CWD, type SessionManager } from "./session-manager.js";

const exec = promisify(execFile);

import type { SessionMode } from "./types.js";

const SCAN_INTERVAL_MS = 2000;
const LIVENESS_INTERVAL_MS = 500;

const COMPLETION_DELAY_MS = 5000;

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** True when both cwds are known (non-empty, non-placeholder) and disagree.
 *  Used as a "different process" signal across the pid-identity checks below. */
function cwdConflict(expected: string | undefined, live: string | undefined): boolean {
  return !!expected && expected !== UNKNOWN_CWD && !!live && live !== expected;
}

/** ms-epoch values are never 0 in practice, so the falsy guards are safe. */
function startTimeConflict(
  expected: number | undefined,
  live: number | null | undefined,
): boolean {
  return !!expected && !!live && expected !== live;
}

interface SessionIdentity {
  workingDirectory?: string;
  processStartedAt?: number;
}

interface ProcessInfo {
  pid: number;
  parentPid: number;
  cwd: string | null;
  terminal: string | null;
  tty: string | null;
  cpuPercent: number;
  /** ms-epoch from `ps -o lstart=`. Null when the lookup or parse failed
   *  — callers must not synthesize a fallback (would poison identity). */
  startedAt: number | null;
  gitBranch: string | null;
  gitWorktree: string | null;
  gitRepoName: string | null;
  sessionMode: SessionMode;
}

export class ProcessScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private livenessTimer: ReturnType<typeof setInterval> | null = null;
  private sm: SessionManager;
  private pendingDeletions = new Set<string>();

  constructor(sm: SessionManager) {
    this.sm = sm;
  }

  start() {
    this.scan();
    this.timer = setInterval(() => this.scan(), SCAN_INTERVAL_MS);
    this.livenessTimer = setInterval(() => this.checkLiveness(), LIVENESS_INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.livenessTimer) clearInterval(this.livenessTimer);
  }

  /** Cheap poll: if any tracked Claude pid has vanished (e.g. user closed
   *  the Ghostty tab/pane), kick off a full scan immediately so the UI
   *  reflects the death without waiting for the next SCAN_INTERVAL tick. */
  private checkLiveness() {
    for (const s of Object.values(this.sm.sessions)) {
      const pid = s.processPid ?? s.terminalPid;
      if (!pid) continue;
      try {
        process.kill(pid, 0);
      } catch {
        void this.scan();
        return;
      }
    }
  }

  private async scan() {
    const activePids = await this.findClaudeProcesses();
    const activeByPid = new Map(activePids.map((p) => [p.pid, p] as const));

    // Build the pid → hook-session lookup once up-front. When a hook session
    // already represents a Claude pid, we must NOT (re)create a proc-<pid>
    // shadow entry for it — a previous scan merged the proc session away,
    // and recreating it would be picked up as "new" and re-trigger /color
    // injection on every scan.
    const hookByClaudePid: Record<number, string> = {};
    for (const [id, s] of Object.entries(this.sm.sessions)) {
      if (id.startsWith("proc-")) continue;
      // Match by terminalPid (bridge PPID) or processPid (set by previous dedup merge)
      if (s.terminalPid != null) hookByClaudePid[s.terminalPid] = id;
      if (s.processPid != null) hookByClaudePid[s.processPid] = id;
    }

    // Resolve each live pid to a hook session once, up-front, so the skip-create
    // and push-live loops below see consistent matches even if `this.sm.sessions`
    // mutates mid-scan (the orphan check awaits, and inbound hook events can
    // land in between). pid alone is not a stable identity — macOS recycles
    // pids, so a recycled pid taken over by a different Claude would otherwise
    // silently keep updating the dead hook session. Cwd disagreement = different
    // process, no match.
    const hookForLivePid = new Map<number, string>();
    for (const info of activePids) {
      const candidate = hookByClaudePid[info.pid];
      if (!candidate) continue;
      const hook = this.sm.sessions[candidate];
      if (!hook) continue;
      if (cwdConflict(hook.workingDirectory, info.cwd ?? undefined)) continue;
      // Don't let push-live overwrite hook data when the pid was recycled; the
      // orphan loop will reap the dead hook on its own.
      if (startTimeConflict(hook.processStartedAt, info.startedAt)) continue;
      hookForLivePid.set(info.pid, candidate);
    }

    // Add / update proc-<pid> sessions. Skip any pid that's already
    // represented by a hook session (see comment above).
    for (const info of activePids) {
      if (hookForLivePid.has(info.pid)) continue;
      const sessionId = `proc-${info.pid}`;
      if (!this.sm.sessions[sessionId]) {
        this.sm.sessions[sessionId] = {
          id: sessionId,
          workingDirectory: info.cwd ?? "~",
          terminalPid: info.parentPid,
          terminalApp: info.terminal ?? undefined,
          status: "active",
          startedAt: info.startedAt ?? Date.now(),
          lastActivity: Date.now(),
          contextTokens: 0,
          maxContextTokens: 0,
          cpuPercent: 0,
          tty: info.tty ?? undefined,
          processPid: info.pid,
          processStartedAt: info.startedAt ?? undefined,
          gitBranch: info.gitBranch ?? undefined,
          gitWorktree: info.gitWorktree ?? undefined,
          gitRepoName: info.gitRepoName ?? undefined,
          sessionMode: info.sessionMode,
        };
        if (!this.sm.heroSessionId) this.sm.heroSessionId = sessionId;
      }
      // Update live fields (not lastActivity)
      this.sm.setStatus(sessionId, "active");
      this.sm.sessions[sessionId].tty = info.tty ?? undefined;
      this.sm.sessions[sessionId].processPid = info.pid;
      this.sm.sessions[sessionId].processStartedAt =
        info.startedAt ?? this.sm.sessions[sessionId].processStartedAt;
      this.sm.sessions[sessionId].cpuPercent = info.cpuPercent;
      this.sm.sessions[sessionId].gitBranch = info.gitBranch ?? undefined;
      this.sm.sessions[sessionId].gitWorktree = info.gitWorktree ?? undefined;
      this.sm.sessions[sessionId].gitRepoName = info.gitRepoName ?? undefined;
      // Process-detected modes (dangerous/auto) override; don't clobber hook-sourced plan mode
      if (info.sessionMode !== "normal") {
        this.sm.sessions[sessionId].sessionMode = info.sessionMode;
      }
    }

    // Mark completed and schedule deletion if process gone. We check
    // kill(pid, 0) for cheap liveness, then cross-check the pid still maps
    // to a `claude` AND its cwd matches — macOS recycles pids, and a stale
    // session whose original Claude died can sit forever pointing at a
    // recycled pid that kill(pid, 0) reports as "alive" (potentially even
    // owned by another Claude, which would defeat a comm-only check).
    const orphanChecks = await Promise.all(
      Object.entries(this.sm.sessions)
        .filter(([id]) => !this.pendingDeletions.has(id))
        .map(async ([id, session]) => {
          let pid: number | undefined;
          if (id.startsWith("proc-")) {
            const candidate = session.processPid ?? Number(id.slice("proc-".length));
            if (Number.isFinite(candidate)) pid = candidate;
          } else if (session.processPid != null) {
            pid = session.processPid;
          } else if (session.terminalPid != null) {
            // Hook sessions without a processPid: fall back to bridge's parent
            // (the Claude that spawned the hook).
            pid = session.terminalPid;
          }
          const isOrphan =
            pid !== undefined &&
            !(await this.pidIsClaude(
              pid,
              {
                workingDirectory: session.workingDirectory,
                processStartedAt: session.processStartedAt,
              },
              activeByPid,
            ));
          return { id, isOrphan };
        }),
    );

    for (const { id, isOrphan } of orphanChecks) {
      if (!isOrphan) continue;
      this.sm.setStatus(id, "completed");
      this.pendingDeletions.add(id);
      setTimeout(() => {
        const tty = this.sm.sessions[id]?.tty;
        delete this.sm.sessions[id];
        this.pendingDeletions.delete(id);
        this.sm.idleSessions.delete(id);
        this.sm.transcriptWatcher.detach(id);
        // Evict TTY from coloredTtys if no remaining session uses it,
        // so new sessions on reused TTYs still get color injection.
        if (tty && !Object.values(this.sm.sessions).some((s) => s.tty === tty)) {
          this.sm.coloredTtys.delete(tty);
        }
        this.sm.emitUpdate();
      }, COMPLETION_DELAY_MS);
    }

    // Dedup by Claude pid, not cwd — two Claudes in the same folder must stay
    // separate. A hook session stores Claude's pid in `terminalPid` (bridge's
    // parent == the Claude process that spawned the hook). A proc- session's
    // `processPid` is the same Claude pid. Match on that identity.
    // `hookByClaudePid` was built at the top of scan().
    for (const id of Object.keys(this.sm.sessions)) {
      if (!id.startsWith("proc-")) continue;
      const proc = this.sm.sessions[id];
      if (!proc?.processPid) continue;
      const hookId = hookByClaudePid[proc.processPid];
      if (!hookId || hookId === id) continue;

      const kept = this.sm.sessions[hookId];
      // pid reuse guard: cwd or start-time mismatch means a different Claude
      // now owns this pid. Leave the proc- session alone; orphan loop reaps.
      if (cwdConflict(kept.workingDirectory, proc.workingDirectory)) continue;
      if (startTimeConflict(kept.processStartedAt, proc.processStartedAt)) continue;
      if (proc.tty) kept.tty = proc.tty;
      if (proc.processPid) kept.processPid = proc.processPid;
      if (proc.processStartedAt) kept.processStartedAt = proc.processStartedAt;
      if (proc.cpuPercent) kept.cpuPercent = proc.cpuPercent;
      if (proc.terminalApp) kept.terminalApp = proc.terminalApp;
      if (proc.gitBranch) kept.gitBranch = proc.gitBranch;
      if (proc.gitWorktree) kept.gitWorktree = proc.gitWorktree;
      if (proc.gitRepoName) kept.gitRepoName = proc.gitRepoName;
      if (proc.sessionMode && proc.sessionMode !== "normal") {
        kept.sessionMode = proc.sessionMode;
      }
      // Carry over agentColor, Ghostty terminal id, and the "already injected
      // /color" flag so we don't re-run the bootstrap after the hook session
      // supersedes the proc entry.
      if (proc.agentColor) kept.agentColor = proc.agentColor;
      if (proc.ghosttyTerminalId) kept.ghosttyTerminalId = proc.ghosttyTerminalId;
      if (this.sm.coloredSessions.has(id)) {
        this.sm.coloredSessions.add(hookId);
        this.sm.coloredSessions.delete(id);
      }
      delete this.sm.sessions[id];
    }

    // Push live tty/pid/cpu into the matching hook session (by Claude pid).
    // On first scan: only capture the Ghostty terminal id (don't type /color
    // into pre-existing sessions). On later scans: inject /color + capture id
    // for brand-new sessions.
    for (const info of activePids) {
      const hookId = hookForLivePid.get(info.pid);
      if (!hookId) continue;
      const hookSession = this.sm.sessions[hookId];
      if (!hookSession) continue;
      hookSession.tty = info.tty ?? undefined;
      hookSession.processPid = info.pid;
      hookSession.processStartedAt = info.startedAt ?? hookSession.processStartedAt;
      hookSession.cpuPercent = info.cpuPercent;
      if (hookSession.tty && !hookSession.ghosttyTerminalId) {
        this.sm.tryCaptureTerminalId(hookSession);
      }
    }

    for (const info of activePids) {
      const sessionId = `proc-${info.pid}`;
      const session = this.sm.sessions[sessionId];
      if (!session?.tty) continue;
      if (!session.ghosttyTerminalId) {
        this.sm.tryCaptureTerminalId(session);
      }
    }

    this.updateHeroSession();
    this.sm.emitUpdate();
  }

  private updateHeroSession() {
    // Ghostty's currently-focused tab wins when it maps to a known session.
    if (this.sm.focusedSessionId && this.sm.sessions[this.sm.focusedSessionId]) {
      this.sm.heroSessionId = this.sm.focusedSessionId;
      return;
    }

    // Prefer an actively thinking session
    const thinking = Object.values(this.sm.sessions).find(
      (s) => s.status === "active" && s.isThinking,
    );
    if (thinking) {
      this.sm.heroSessionId = thinking.id;
      return;
    }

    // Keep current hero if still valid
    if (this.sm.heroSessionId && this.sm.sessions[this.sm.heroSessionId]) return;

    // Pick by most recent activity
    const mostRecent = Object.values(this.sm.sessions).reduce(
      (best, s) => (s.lastActivity > (best?.lastActivity ?? 0) ? s : best),
      null as (typeof this.sm.sessions)[string] | null,
    );
    if (mostRecent) this.sm.heroSessionId = mostRecent.id;
  }

  private async findClaudeProcesses(): Promise<ProcessInfo[]> {
    // Use ps instead of pgrep — pgrep silently misses some processes on macOS
    let psOutput: string;
    try {
      const { stdout } = await exec("/bin/ps", ["-eo", "pid,comm,args"]);
      psOutput = stdout;
    } catch {
      return [];
    }

    const results: ProcessInfo[] = [];
    const lines = psOutput.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 3) continue;
      const pid = parseInt(cols[0]);
      const comm = cols[1];
      const args = cols.slice(2).join(" ");

      if (isNaN(pid)) continue;

      // Only match processes whose executable is "claude"
      const commBase = comm.split("/").pop() ?? "";
      if (commBase !== "claude") continue;

      const cmdLine = `${comm} ${args}`;
      if (/BnotBridge|VibeBridge|Bnot|pgrep|claude-code-guide/.test(cmdLine)) continue;
      if (cmdLine.includes("--print") || cmdLine.includes("--output-format")) continue;
      if (cmdLine.includes("--resume") && cmdLine.includes("--no-session")) continue;

      const [parentPid, cwd, tty, cpu, startedAt] = await Promise.all([
        this.getParentPid(pid),
        this.getCwd(pid),
        this.getTty(pid),
        this.getCpu(pid),
        this.getStartTime(pid),
      ]);

      if (!cwd || cwd === "/") continue;

      // Detect session mode from CLI args
      let sessionMode: SessionMode = "normal";
      if (args.includes("--dangerously-skip-permissions")) {
        sessionMode = "dangerous";
      } else if (/--allowedTools\s+['"]?\*['"]?/.test(args)) {
        sessionMode = "auto";
      }

      const [terminal, gitBranch, worktreeInfo] = await Promise.all([
        this.getTerminal(parentPid),
        this.getGitBranch(cwd),
        this.getGitWorktree(cwd),
      ]);
      results.push({
        pid,
        parentPid,
        cwd,
        terminal,
        tty,
        cpuPercent: cpu,
        startedAt,
        gitBranch,
        gitWorktree: worktreeInfo?.worktree ?? null,
        gitRepoName: worktreeInfo?.repoName ?? null,
        sessionMode,
      });
    }

    return results;
  }

  /**
   * True iff `pid` is alive AND still owned by THIS session's Claude.
   * The fallback (pid alive but absent from `activeByPid`) does a live
   * cwd + start-time lookup rather than trusting comm — a recycled pid can
   * land on a Claude variant excluded from `findClaudeProcesses` (--print,
   * --no-session+--resume, claude-code-guide subagents), defeating a
   * comm-only check.
   */
  private async pidIsClaude(
    pid: number,
    expected: SessionIdentity,
    activeByPid: Map<number, ProcessInfo>,
  ): Promise<boolean> {
    if (!isPidAlive(pid)) return false;

    const live = activeByPid.get(pid);
    if (live) {
      if (cwdConflict(expected.workingDirectory, live.cwd ?? undefined)) return false;
      if (startTimeConflict(expected.processStartedAt, live.startedAt)) return false;
      return true;
    }

    if (basename(await this.getComm(pid)) !== "claude") return false;
    const [liveCwd, liveStart] = await Promise.all([this.getCwd(pid), this.getStartTime(pid)]);
    if (cwdConflict(expected.workingDirectory, liveCwd ?? undefined)) return false;
    if (startTimeConflict(expected.processStartedAt, liveStart)) return false;
    return true;
  }

  private async getComm(pid: number): Promise<string> {
    try {
      const { stdout } = await exec("/bin/ps", ["-o", "comm=", "-p", String(pid)]);
      return stdout.trim();
    } catch {
      return "";
    }
  }

  private async getParentPid(pid: number): Promise<number> {
    try {
      const { stdout } = await exec("/bin/ps", ["-o", "ppid=", "-p", String(pid)]);
      return parseInt(stdout.trim()) || 0;
    } catch {
      return 0;
    }
  }

  private async getCwd(pid: number): Promise<string | null> {
    try {
      const { stdout } = await exec("/usr/sbin/lsof", [
        "-a",
        "-p",
        String(pid),
        "-d",
        "cwd",
        "-Fn",
      ]);
      for (const line of stdout.split("\n")) {
        if (line.startsWith("n/")) return line.slice(1);
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async getTty(pid: number): Promise<string | null> {
    try {
      const { stdout } = await exec("/bin/ps", ["-o", "tty=", "-p", String(pid)]);
      const tty = stdout.trim();
      return tty || null;
    } catch {
      return null;
    }
  }

  private async getCpu(pid: number): Promise<number> {
    try {
      const { stdout } = await exec("/bin/ps", ["-o", "%cpu=", "-p", String(pid)]);
      return parseFloat(stdout.trim()) || 0;
    } catch {
      return 0;
    }
  }

  private async getStartTime(pid: number): Promise<number | null> {
    try {
      // lstart gives the exact start time, e.g. "Mon Apr  6 22:50:00 2026"
      const { stdout } = await exec("/bin/ps", ["-o", "lstart=", "-p", String(pid)]);
      const t = new Date(stdout.trim()).getTime();
      return isNaN(t) ? null : t;
    } catch {
      return null;
    }
  }

  private async getGitBranch(cwd: string): Promise<string | null> {
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

  private async getGitWorktree(
    cwd: string,
  ): Promise<{ worktree: string; repoName: string } | null> {
    try {
      const [gitDir, commonDir] = await Promise.all([
        exec("/usr/bin/git", ["-C", cwd, "rev-parse", "--git-dir"]).then((r) => r.stdout.trim()),
        exec("/usr/bin/git", ["-C", cwd, "rev-parse", "--git-common-dir"]).then((r) =>
          r.stdout.trim(),
        ),
      ]);
      // If they differ, this is a worktree
      if (gitDir !== commonDir) {
        const worktree = cwd.split("/").pop() ?? cwd;
        // commonDir is like /path/to/repo/.git — repo name is parent dir
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

  private async getTerminal(parentPid: number): Promise<string | null> {
    const comm = await this.getComm(parentPid);
    if (!comm) return null;
    if (comm.includes("iTerm")) return "iTerm2";
    if (comm.includes("Terminal")) return "Terminal";
    if (comm.includes("Warp")) return "Warp";
    if (/ghostty|Ghostty/.test(comm)) return "Ghostty";
    if (comm.includes("Alacritty")) return "Alacritty";
    if (comm.includes("kitty")) return "Kitty";
    return null;
  }
}
