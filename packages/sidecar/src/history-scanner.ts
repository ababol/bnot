import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { emit } from "./ipc.js";
import type { HistorySession } from "./types.js";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const MAX_HISTORY = 20;

export class HistoryScanner {
  private timer: ReturnType<typeof setInterval> | null = null;

  start() {
    // Initial scan after a short delay to let ProcessScanner populate first
    setTimeout(() => this.scan(), 4000);
    this.timer = setInterval(() => this.scan(), 30000);
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
          const e = entry as Record<string, unknown>;
          if (!e.sessionId || typeof e.sessionId !== "string") continue;
          if (activeIds.has(e.sessionId)) continue;
          if (e.isSidechain === true) continue;

          const firstPrompt = (e.firstPrompt as string) ?? "";
          if (!firstPrompt || firstPrompt === "No prompt") continue;

          all.push({
            sessionId: e.sessionId as string,
            projectPath: (e.projectPath as string) ?? "",
            summary: (e.summary as string) ?? "",
            firstPrompt,
            messageCount: (e.messageCount as number) ?? 0,
            gitBranch: (e.gitBranch as string) ?? undefined,
            created: (e.created as string) ?? "",
            modified: (e.modified as string) ?? "",
          });
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
