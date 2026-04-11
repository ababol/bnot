import * as fs from "fs/promises";
import * as path from "path";
import { emit } from "./ipc.js";
import { CLAUDE_DIR } from "./paths.js";
import type { HistorySession } from "./types.js";

const INITIAL_SCAN_DELAY_MS = 4000;
const SCAN_INTERVAL_MS = 30000;
const MAX_HISTORY = 20;

export class HistoryScanner {
  private timer: ReturnType<typeof setInterval> | null = null;

  start() {
    // Initial scan after a short delay to let ProcessScanner populate first
    setTimeout(() => this.scan(), INITIAL_SCAN_DELAY_MS);
    this.timer = setInterval(() => this.scan(), SCAN_INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private async scan() {
    try {
      const activeSessionIds = await this.getActiveSessionIds();
      const history = await this.readAllHistory(activeSessionIds);
      emit("historyUpdated", { history });
    } catch {
      // Silently ignore — history is best-effort
    }
  }

  private async getActiveSessionIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    const sessionsDir = path.join(CLAUDE_DIR, "sessions");
    let files: string[];
    try {
      files = await fs.readdir(sessionsDir);
    } catch {
      return ids;
    }

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const data = await fs.readFile(path.join(sessionsDir, file), "utf-8");
        const meta = JSON.parse(data);
        if (!meta.pid || !meta.sessionId) continue;
        try {
          process.kill(meta.pid, 0);
          ids.add(meta.sessionId);
        } catch {
          // Process is dead — not active
        }
      } catch {
        // Skip malformed files
      }
    }

    return ids;
  }

  private async readAllHistory(activeIds: Set<string>): Promise<HistorySession[]> {
    const projectsDir = path.join(CLAUDE_DIR, "projects");
    let projectDirs: string[];
    try {
      projectDirs = await fs.readdir(projectsDir);
    } catch {
      return [];
    }

    const all: HistorySession[] = [];

    for (const dir of projectDirs) {
      const indexPath = path.join(projectsDir, dir, "sessions-index.json");
      try {
        const data = await fs.readFile(indexPath, "utf-8");
        const entries: unknown[] = JSON.parse(data);
        if (!Array.isArray(entries)) continue;

        for (const entry of entries) {
          const parsed = parseHistoryEntry(entry, activeIds);
          if (parsed) all.push(parsed);
        }
      } catch {
        // Skip malformed index files
      }
    }

    // Sort by modified date descending, take top N
    all.sort((a, b) => {
      const ta = new Date(b.modified).getTime() || 0;
      const tb = new Date(a.modified).getTime() || 0;
      return ta - tb;
    });

    return all.slice(0, MAX_HISTORY);
  }
}

function parseHistoryEntry(entry: unknown, activeIds: Set<string>): HistorySession | null {
  const e = entry as Record<string, unknown>;
  const sessionId = typeof e.sessionId === "string" ? e.sessionId : null;
  if (!sessionId || activeIds.has(sessionId)) return null;
  if (e.isSidechain === true) return null;

  const firstPrompt = typeof e.firstPrompt === "string" ? e.firstPrompt : "";
  if (!firstPrompt || firstPrompt === "No prompt") return null;

  return {
    sessionId,
    projectPath: typeof e.projectPath === "string" ? e.projectPath : "",
    summary: typeof e.summary === "string" ? e.summary : "",
    firstPrompt,
    messageCount: typeof e.messageCount === "number" ? e.messageCount : 0,
    gitBranch: typeof e.gitBranch === "string" ? e.gitBranch : undefined,
    created: typeof e.created === "string" ? e.created : "",
    modified: typeof e.modified === "string" ? e.modified : "",
  };
}
