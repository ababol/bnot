import * as fs from "fs/promises";
import * as path from "path";
import { HistoryScanner } from "./history-scanner.js";
import { emit } from "./ipc.js";
import { WORKTREES_DIR } from "./paths.js";
import { SessionManager } from "./session-manager.js";
import type { AgentSession, HistorySession, WorktreeRecord } from "./types.js";

const SCAN_INTERVAL_MS = 20000;
const INITIAL_SCAN_DELAY_MS = 2000;
const DEBOUNCE_MS = 150;

export class WorktreeRegistry {
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeHistory: (() => void) | null = null;
  private lastSerialized = "";

  constructor(
    private sessionManager: SessionManager,
    private historyScanner: HistoryScanner,
  ) {}

  start() {
    setTimeout(() => void this.scan(), INITIAL_SCAN_DELAY_MS);
    this.timer = setInterval(() => void this.scan(), SCAN_INTERVAL_MS);
    this.unsubscribeHistory = this.historyScanner.onUpdate(() => this.triggerScan());
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.pending) clearTimeout(this.pending);
    this.unsubscribeHistory?.();
  }

  /** Debounced rescan — coalesces rapid triggers (session update + history update). */
  triggerScan() {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      void this.scan();
    }, DEBOUNCE_MS);
  }

  private async scan() {
    try {
      const worktrees = await this.collectWorktrees();
      // Skip the emit (and the downstream frontend re-render cascade) when
      // nothing actually changed — every scan otherwise churns the reducer.
      const serialized = JSON.stringify(worktrees);
      if (serialized === this.lastSerialized) return;
      this.lastSerialized = serialized;
      emit("worktreesUpdated", { worktrees });
    } catch (err) {
      process.stderr.write(`[worktree-registry] scan error: ${err}\n`);
    }
  }

  private async collectWorktrees(): Promise<WorktreeRecord[]> {
    // Layout: WORKTREES_DIR/<repoName>/<branchDir>/
    let repoDirs: string[];
    try {
      repoDirs = await fs.readdir(WORKTREES_DIR);
    } catch {
      return [];
    }

    const historyByPath = new Map<string, HistorySession>();
    for (const h of this.historyScanner.latest) historyByPath.set(h.projectPath, h);
    const sessions: AgentSession[] = Object.values(this.sessionManager.sessions);
    const out: WorktreeRecord[] = [];

    for (const repoName of repoDirs) {
      const repoPath = path.join(WORKTREES_DIR, repoName);
      let branchDirs: string[];
      try {
        branchDirs = await fs.readdir(repoPath);
      } catch {
        continue;
      }

      for (const branchDir of branchDirs) {
        const worktreePath = path.join(repoPath, branchDir);
        const record = await buildRecord(
          worktreePath,
          repoName,
          branchDir,
          sessions,
          historyByPath,
        );
        if (record) out.push(record);
      }
    }

    out.sort((a, b) => b.lastActivity - a.lastActivity);
    return out;
  }
}

async function buildRecord(
  worktreePath: string,
  repoName: string,
  branchDir: string,
  sessions: AgentSession[],
  historyByPath: Map<string, HistorySession>,
): Promise<WorktreeRecord | null> {
  // A valid worktree is a directory with a .git entry (file for git worktrees,
  // directory for the main checkout). Stat it in one syscall — no separate
  // access() dance, and no spawning git rev-parse every scan (branchDir is
  // already the sanitized branch name written by worktree-creator.ts).
  let stat;
  try {
    stat = await fs.stat(worktreePath);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return null;

  try {
    await fs.stat(path.join(worktreePath, ".git"));
  } catch {
    return null;
  }

  const liveSession = sessions.find(
    (s) => s.workingDirectory === worktreePath && s.status !== "completed",
  );
  const anySession = sessions.find((s) => s.workingDirectory === worktreePath);

  let lastActivity = stat.mtimeMs;
  if (anySession) lastActivity = Math.max(lastActivity, anySession.lastActivity);
  const h = historyByPath.get(worktreePath);
  if (h) {
    const t = Date.parse(h.modified);
    if (!Number.isNaN(t)) lastActivity = Math.max(lastActivity, t);
  }

  return {
    path: worktreePath,
    repoName,
    branch: branchDir,
    lastActivity,
    activeSessionId: liveSession?.id,
  };
}
