import { execFile } from "child_process";
import { promisify } from "util";
import type { SessionManager } from "./session-manager.js";

const exec = promisify(execFile);

import type { SessionMode } from "./types.js";

const SCAN_INTERVAL_MS = 2000;
const LIVENESS_INTERVAL_MS = 500;
const CPU_ACTIVE_THRESHOLD = 2.0;
const COMPLETION_DELAY_MS = 5000;

interface ProcessInfo {
  pid: number;
  parentPid: number;
  cwd: string | null;
  terminal: string | null;
  tty: string | null;
  cpuPercent: number;
  startedAt: number;
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
  private firstScanDone = false;

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
      const pid = s.processPid;
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

    // Add new sessions
    for (const info of activePids) {
      const sessionId = `proc-${info.pid}`;
      if (!this.sm.sessions[sessionId]) {
        this.sm.sessions[sessionId] = {
          id: sessionId,
          workingDirectory: info.cwd ?? "~",
          terminalPid: info.parentPid,
          terminalApp: info.terminal ?? undefined,
          status: "active",
          startedAt: info.startedAt,
          lastActivity: Date.now(),
          contextTokens: 0,
          maxContextTokens: 0,
          cpuPercent: 0,
          tty: info.tty ?? undefined,
          processPid: info.pid,
          gitBranch: info.gitBranch ?? undefined,
          gitWorktree: info.gitWorktree ?? undefined,
          gitRepoName: info.gitRepoName ?? undefined,
          sessionMode: info.sessionMode,
        };
        if (!this.sm.heroSessionId) this.sm.heroSessionId = sessionId;
      }
      // Update live fields (not lastActivity)
      // Detect idle→working transition to track current task duration
      const wasIdle = this.sm.sessions[sessionId].cpuPercent < CPU_ACTIVE_THRESHOLD;
      const isWorking = info.cpuPercent >= CPU_ACTIVE_THRESHOLD;
      if (wasIdle && isWorking) {
        this.sm.sessions[sessionId].taskStartedAt = Date.now();
      } else if (!isWorking) {
        this.sm.sessions[sessionId].taskStartedAt = undefined;
      }
      this.sm.sessions[sessionId].status = "active";
      this.sm.sessions[sessionId].tty = info.tty ?? undefined;
      this.sm.sessions[sessionId].processPid = info.pid;
      this.sm.sessions[sessionId].cpuPercent = info.cpuPercent;
      this.sm.sessions[sessionId].gitBranch = info.gitBranch ?? undefined;
      this.sm.sessions[sessionId].gitWorktree = info.gitWorktree ?? undefined;
      this.sm.sessions[sessionId].gitRepoName = info.gitRepoName ?? undefined;
      // Process-detected modes (dangerous/auto) override; don't clobber hook-sourced plan mode
      if (info.sessionMode !== "normal") {
        this.sm.sessions[sessionId].sessionMode = info.sessionMode;
      }
    }

    const activePidSet = new Set(activePids.map((p) => `proc-${p.pid}`));
    const alivePids = new Set(activePids.map((p) => p.pid));

    // Mark completed and schedule deletion if process gone
    for (const [id, session] of Object.entries(this.sm.sessions)) {
      if (this.pendingDeletions.has(id)) continue;

      const isOrphan = id.startsWith("proc-")
        ? !activePidSet.has(id)
        : session.processPid != null && !alivePids.has(session.processPid);

      if (isOrphan) {
        this.sm.sessions[id].status = "completed";
        this.pendingDeletions.add(id);
        setTimeout(() => {
          delete this.sm.sessions[id];
          this.pendingDeletions.delete(id);
          this.sm.emitUpdate();
        }, COMPLETION_DELAY_MS);
      }
    }

    // Dedup by Claude pid, not cwd — two Claudes in the same folder must stay
    // separate. A hook session stores Claude's pid in `terminalPid` (bridge's
    // parent == the Claude process that spawned the hook). A proc- session's
    // `processPid` is the same Claude pid. Match on that identity.
    const hookByClaudePid: Record<number, string> = {};
    for (const [id, s] of Object.entries(this.sm.sessions)) {
      if (id.startsWith("proc-")) continue;
      if (s.terminalPid != null) hookByClaudePid[s.terminalPid] = id;
    }

    for (const id of Object.keys(this.sm.sessions)) {
      if (!id.startsWith("proc-")) continue;
      const proc = this.sm.sessions[id];
      if (!proc?.processPid) continue;
      const hookId = hookByClaudePid[proc.processPid];
      if (!hookId || hookId === id) continue;

      const kept = this.sm.sessions[hookId];
      if (proc.tty) kept.tty = proc.tty;
      if (proc.processPid) kept.processPid = proc.processPid;
      if (proc.cpuPercent) kept.cpuPercent = proc.cpuPercent;
      if (proc.terminalApp) kept.terminalApp = proc.terminalApp;
      if (proc.gitBranch) kept.gitBranch = proc.gitBranch;
      if (proc.gitWorktree) kept.gitWorktree = proc.gitWorktree;
      if (proc.gitRepoName) kept.gitRepoName = proc.gitRepoName;
      if (proc.sessionMode && proc.sessionMode !== "normal") {
        kept.sessionMode = proc.sessionMode;
      }
      delete this.sm.sessions[id];
    }

    // Push live tty/pid/cpu into the matching hook session (by Claude pid)
    // and trigger /color injection once a tty appears (skip first scan so
    // sessions that already existed before launch aren't retyped).
    for (const info of activePids) {
      const hookId = hookByClaudePid[info.pid];
      if (!hookId) continue;
      const hookSession = this.sm.sessions[hookId];
      if (!hookSession) continue;
      hookSession.tty = info.tty ?? undefined;
      hookSession.processPid = info.pid;
      hookSession.cpuPercent = info.cpuPercent;
      if (this.firstScanDone && hookSession.tty && !this.sm.coloredSessions.has(hookId)) {
        this.sm.tryInjectColor(hookSession);
      }
    }

    // Also trigger injection for fresh proc- sessions that have a tty.
    if (this.firstScanDone) {
      for (const info of activePids) {
        const sessionId = `proc-${info.pid}`;
        const session = this.sm.sessions[sessionId];
        if (session?.tty && !this.sm.coloredSessions.has(sessionId)) {
          this.sm.tryInjectColor(session);
        }
      }
    }

    // On the first scan, treat all pre-existing sessions as already colored
    // so we don't re-inject /color for sessions that were alive before launch.
    if (!this.firstScanDone) {
      for (const id of Object.keys(this.sm.sessions)) {
        this.sm.coloredSessions.add(id);
      }
      this.firstScanDone = true;
    }

    this.updateHeroSession();
    this.sm.emitUpdate();
  }

  private updateHeroSession() {
    const active = Object.values(this.sm.sessions).filter((s) => s.status === "active");
    const busiest = active.reduce(
      (best, s) => (s.cpuPercent > (best?.cpuPercent ?? 0) ? s : best),
      null as (typeof active)[0] | null,
    );
    if (busiest && busiest.cpuPercent > CPU_ACTIVE_THRESHOLD) {
      this.sm.heroSessionId = busiest.id;
      return;
    }

    // Keep current hero if still valid
    if (this.sm.heroSessionId && this.sm.sessions[this.sm.heroSessionId]) return;

    // Pick by most recent activity
    const mostRecent = Object.values(this.sm.sessions).reduce(
      (best, s) => (s.lastActivity > (best?.lastActivity ?? 0) ? s : best),
      null as (typeof active)[0] | null,
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
      if (/BuddyBridge|VibeBridge|BuddyNotch|pgrep|claude-code-guide/.test(cmdLine)) continue;
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

  private async getStartTime(pid: number): Promise<number> {
    try {
      // lstart gives the exact start time, e.g. "Mon Apr  6 22:50:00 2026"
      const { stdout } = await exec("/bin/ps", ["-o", "lstart=", "-p", String(pid)]);
      const t = new Date(stdout.trim()).getTime();
      return isNaN(t) ? Date.now() : t;
    } catch {
      return Date.now();
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
    try {
      const { stdout } = await exec("/bin/ps", ["-o", "comm=", "-p", String(parentPid)]);
      const comm = stdout.trim();
      if (comm.includes("iTerm")) return "iTerm2";
      if (comm.includes("Terminal")) return "Terminal";
      if (comm.includes("Warp")) return "Warp";
      if (/ghostty|Ghostty/.test(comm)) return "Ghostty";
      if (comm.includes("Alacritty")) return "Alacritty";
      if (comm.includes("kitty")) return "Kitty";
    } catch {
      // ignore
    }
    return null;
  }
}
