import { watch, type FSWatcher } from "fs";
import { open, stat } from "fs/promises";
import type { SessionManager } from "./session-manager.js";

const INTERRUPT_MARKER = "[Request interrupted by user";

interface Tail {
  path: string;
  offset: number;
  watcher: FSWatcher;
  pending: boolean;
  /** Set when an fs.watch event fires while `pending` is true. The in-flight
   *  read re-invokes onChange when it finishes so coalesced writes are not
   *  lost (otherwise the interrupt marker could land in a dropped event). */
  dirty: boolean;
}

/**
 * Tails Claude Code's per-session JSONL transcript and clears `isThinking`
 * when an interrupt marker (`[Request interrupted by user`) is appended.
 * Bridges the gap left by Claude Code not firing any hook on Esc.
 */
export class TranscriptWatcher {
  private tails = new Map<string, Tail>();
  private sm: SessionManager;

  constructor(sm: SessionManager) {
    this.sm = sm;
  }

  async attach(sessionId: string, path: string): Promise<void> {
    const existing = this.tails.get(sessionId);
    if (existing?.path === path) return;
    if (existing) this.detach(sessionId);

    // Start at EOF — pre-existing interrupt markers from past turns must not
    // retro-clear isThinking on the freshly-attached session.
    let offset = 0;
    try {
      offset = (await stat(path)).size;
    } catch {
      // File doesn't exist yet (sessionStart fires before first turn flush).
      // fs.watch on a missing path throws, so don't bind a watcher; the next
      // sessionStart for the same path will retry.
      return;
    }

    let watcher: FSWatcher;
    try {
      watcher = watch(path, () => void this.onChange(sessionId));
    } catch {
      return;
    }
    watcher.on("error", () => this.detach(sessionId));

    this.tails.set(sessionId, { path, offset, watcher, pending: false, dirty: false });
  }

  detach(sessionId: string): void {
    const t = this.tails.get(sessionId);
    if (!t) return;
    try {
      t.watcher.close();
    } catch {
      // ignore
    }
    this.tails.delete(sessionId);
  }

  private async onChange(sessionId: string): Promise<void> {
    const t = this.tails.get(sessionId);
    if (!t) return;
    // Coalesce: macOS fs.watch fires multiple times per write. If an event
    // arrives mid-read, mark dirty so we re-run after this read finishes.
    if (t.pending) {
      t.dirty = true;
      return;
    }
    t.pending = true;
    try {
      const fd = await open(t.path, "r");
      try {
        const st = await fd.stat();
        // File rotated/truncated (auto-compact rewrites the JSONL).
        if (st.size < t.offset) t.offset = 0;
        if (st.size === t.offset) return;

        const buf = Buffer.alloc(st.size - t.offset);
        await fd.read(buf, 0, buf.length, t.offset);
        t.offset = st.size;
        // Boyer-Moore prefilter: skip JSON.parse on the hot path when the
        // marker isn't present anywhere in the appended bytes.
        if (buf.indexOf(INTERRUPT_MARKER) === -1) return;
        for (const line of buf.toString("utf8").split("\n")) {
          if (!line || !line.includes(INTERRUPT_MARKER)) continue;
          if (this.isInterruptLine(line)) {
            this.sm.applyInterrupt(sessionId);
            break;
          }
        }
      } finally {
        await fd.close();
      }
    } catch {
      // File missing / read error — try again on next change event
    } finally {
      const wasDirty = t.dirty;
      t.pending = false;
      t.dirty = false;
      if (wasDirty) void this.onChange(sessionId);
    }
  }

  private isInterruptLine(line: string): boolean {
    try {
      const obj = JSON.parse(line);
      if (obj?.type !== "user") return false;
      const content = obj?.message?.content;
      if (typeof content === "string") return content.includes(INTERRUPT_MARKER);
      if (Array.isArray(content)) {
        return content.some(
          (b: { type?: string; text?: string }) =>
            b?.type === "text" &&
            typeof b?.text === "string" &&
            b.text.includes(INTERRUPT_MARKER),
        );
      }
    } catch {
      // malformed line — skip
    }
    return false;
  }
}
