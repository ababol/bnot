import { execFile } from "child_process";
import { promisify } from "util";
import type { SessionManager } from "./session-manager.js";

const exec = promisify(execFile);

interface ProcessInfo {
  pid: number;
  parentPid: number;
  cwd: string | null;
  terminal: string | null;
  tty: string | null;
  cpuPercent: number;
  gitBranch: string | null;
  gitWorktree: string | null;
}

export class ProcessScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private sm: SessionManager;

  constructor(sm: SessionManager) {
    this.sm = sm;
  }

  start() {
    this.scan();
    this.timer = setInterval(() => this.scan(), 2000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
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
          startedAt: Date.now(),
          lastActivity: Date.now(),
          contextTokens: 0,
          maxContextTokens: 0,
          cpuPercent: 0,
          tty: info.tty ?? undefined,
          processPid: info.pid,
          gitBranch: info.gitBranch ?? undefined,
          gitWorktree: info.gitWorktree ?? undefined,
        };
        if (!this.sm.heroSessionId) this.sm.heroSessionId = sessionId;
      }
      // Update live fields (not lastActivity)
      this.sm.sessions[sessionId].status = "active";
      this.sm.sessions[sessionId].tty = info.tty ?? undefined;
      this.sm.sessions[sessionId].processPid = info.pid;
      this.sm.sessions[sessionId].cpuPercent = info.cpuPercent;
      this.sm.sessions[sessionId].gitBranch = info.gitBranch ?? undefined;
      this.sm.sessions[sessionId].gitWorktree = info.gitWorktree ?? undefined;
    }

    const activePidSet = new Set(activePids.map((p) => `proc-${p.pid}`));

    // Mark completed if process gone
    for (const [id, session] of Object.entries(this.sm.sessions)) {
      if (id.startsWith("proc-") && !activePidSet.has(id) && session.status === "active") {
        this.sm.sessions[id].status = "completed";
        setTimeout(() => {
          delete this.sm.sessions[id];
          this.sm.emitUpdate();
        }, 5000);
      }
    }

    // Dedup by cwd: only merge a proc- session with a non-proc (hook-based) session.
    // Never merge two proc- sessions — they're genuinely separate Claude instances.
    const seenCwds: Record<string, string> = {};
    const sortedIds = Object.keys(this.sm.sessions).sort();

    for (const id of sortedIds) {
      const session = this.sm.sessions[id];
      if (!session) continue;
      const cwd = session.workingDirectory;
      const existingId = seenCwds[cwd];

      if (existingId) {
        const existingIsProc = existingId.startsWith("proc-");
        const newIsProc = id.startsWith("proc-");

        // Don't merge two proc- sessions (multiple Claude instances in same dir)
        if (existingIsProc && newIsProc) {
          continue;
        }

        // Prefer hook-based session over proc- session
        const keepId = existingIsProc && !newIsProc ? id : existingId;
        const removeId = keepId === existingId ? id : existingId;

        // Copy process info from removed to kept
        const removed = this.sm.sessions[removeId];
        if (removed) {
          const kept = this.sm.sessions[keepId];
          if (removed.tty) kept.tty = removed.tty;
          if (removed.processPid) kept.processPid = removed.processPid;
          if (removed.cpuPercent) kept.cpuPercent = removed.cpuPercent;
          if (removed.terminalApp) kept.terminalApp = removed.terminalApp;
        }

        delete this.sm.sessions[removeId];
        seenCwds[cwd] = keepId;
      } else {
        seenCwds[cwd] = id;
      }
    }

    // Push tty/pid from proc sessions to matching non-proc sessions
    for (const info of activePids) {
      const match = Object.entries(this.sm.sessions).find(
        ([k, v]) => !k.startsWith("proc-") && v.workingDirectory === (info.cwd ?? ""),
      );
      if (match) {
        match[1].tty = info.tty ?? undefined;
        match[1].processPid = info.pid;
        match[1].cpuPercent = info.cpuPercent;
      }
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
    if (busiest && busiest.cpuPercent > 2.0) {
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

      const [parentPid, cwd, tty, cpu] = await Promise.all([
        this.getParentPid(pid),
        this.getCwd(pid),
        this.getTty(pid),
        this.getCpu(pid),
      ]);

      if (!cwd || cwd === "/") continue;

      const [terminal, gitBranch, gitWorktree] = await Promise.all([
        this.getTerminal(parentPid),
        this.getGitBranch(cwd),
        this.getGitWorktree(cwd),
      ]);
      results.push({ pid, parentPid, cwd, terminal, tty, cpuPercent: cpu, gitBranch, gitWorktree });
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

  private async getGitBranch(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await exec("/usr/bin/git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"]);
      const branch = stdout.trim();
      return branch || null;
    } catch {
      return null;
    }
  }

  private async getGitWorktree(cwd: string): Promise<string | null> {
    try {
      const [gitDir, commonDir] = await Promise.all([
        exec("/usr/bin/git", ["-C", cwd, "rev-parse", "--git-dir"]).then((r) => r.stdout.trim()),
        exec("/usr/bin/git", ["-C", cwd, "rev-parse", "--git-common-dir"]).then((r) => r.stdout.trim()),
      ]);
      // If they differ, this is a worktree — name is the cwd basename
      if (gitDir !== commonDir) {
        return cwd.split("/").pop() ?? null;
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
