import * as fs from "fs";
import * as fsP from "fs/promises";
import { emit } from "./ipc.js";
import { USAGE_PATH } from "./paths.js";

export interface UsageWindow {
  usedPercent: number;
  resetsAt: number; // unix ms
}

export interface UsageSnapshot {
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  cachedAt: number;
}

function parseWindow(raw: unknown): UsageWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  // Canonical shape: { used_percentage, resets_at }
  const usedPercent = typeof obj.used_percentage === "number" ? obj.used_percentage : null;
  const resetsAt =
    typeof obj.resets_at === "string"
      ? new Date(obj.resets_at).getTime()
      : typeof obj.resets_at === "number"
        ? obj.resets_at
        : null;
  if (usedPercent === null || resetsAt === null || isNaN(resetsAt)) return null;
  return { usedPercent, resetsAt };
}

async function readSnapshot(): Promise<UsageSnapshot | null> {
  try {
    const raw = await fsP.readFile(USAGE_PATH, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      fiveHour: parseWindow(data.five_hour),
      sevenDay: parseWindow(data.seven_day),
      cachedAt: typeof data.cached_at === "number" ? data.cached_at : Date.now(),
    };
  } catch {
    return null;
  }
}

export class UsageWatcher {
  private watcher: fs.FSWatcher | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    if (this.watcher) return;

    // Emit current value immediately if file already exists
    readSnapshot()
      .then((snap) => {
        if (snap) emit("usageStats", snap);
      })
      .catch(() => {});

    try {
      this.watcher = fs.watch(USAGE_PATH, () => {
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(async () => {
          const snap = await readSnapshot();
          if (snap) emit("usageStats", snap);
        }, 200);
      });
      this.watcher.on("error", () => {
        // File may not exist yet — that's fine, we'll pick it up when created
        this.watcher?.close();
        this.watcher = null;
        this.watchParent();
      });
    } catch {
      // USAGE_PATH doesn't exist yet — watch parent directory for creation
      this.watchParent();
    }
  }

  /** Watch ~/.bnot/ for usage.json to appear, then switch to watching the file. */
  private watchParent(): void {
    const dir = USAGE_PATH.substring(0, USAGE_PATH.lastIndexOf("/"));
    try {
      const parent = fs.watch(dir, (_event, filename) => {
        if (filename && filename.endsWith("usage.json")) {
          parent.close();
          // Give the writer a moment to finish
          setTimeout(() => this.start(), 500);
        }
      });
    } catch {
      // Can't watch — usage stats just won't update until restart
    }
  }

  stop(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.watcher?.close();
    this.watcher = null;
  }
}
