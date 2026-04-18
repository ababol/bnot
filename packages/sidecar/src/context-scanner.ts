import { readFileSync } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { CLAUDE_DIR } from "./paths.js";
import type { SessionManager } from "./session-manager.js";
import type { AgentSession } from "./types.js";

const INITIAL_SCAN_DELAY_MS = 3000;
const SCAN_INTERVAL_MS = 30000;
const TAIL_READ_BYTES = 65536;

/** CLAUDE_CODE_AUTO_COMPACT_WINDOW — when set (env or ~/.claude/settings.json),
 *  Claude Code auto-compacts at this lower limit instead of the model's full
 *  window, so Bnot should display *this* as the usable max. Read once at
 *  sidecar startup; users who change the value need to relaunch anyway. */
const AUTO_COMPACT_OVERRIDE = readAutoCompactOverride();

function readAutoCompactOverride(): number {
  const envRaw = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  const envVal = envRaw ? Number(envRaw) : 0;
  if (envVal > 0) return envVal;
  try {
    const settings = JSON.parse(readFileSync(path.join(CLAUDE_DIR, "settings.json"), "utf-8"));
    const raw = settings?.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
    const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : 0;
    return n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

interface SessionInfo {
  model?: string;
  usedTokens: number;
  sessionName?: string; // custom-title > agent-name > ai-title
  agentColor?: string;
}

export class ContextScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private triggerTimer: ReturnType<typeof setTimeout> | null = null;
  private sm: SessionManager;

  constructor(sm: SessionManager) {
    this.sm = sm;
  }

  start() {
    // Delay the first scan so ProcessScanner can populate sessionManager first.
    setTimeout(() => this.scan(), INITIAL_SCAN_DELAY_MS);
    this.timer = setInterval(() => this.scan(), SCAN_INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.triggerTimer) clearTimeout(this.triggerTimer);
  }

  triggerScan() {
    if (this.triggerTimer) return;
    this.triggerTimer = setTimeout(() => {
      this.triggerTimer = null;
      void this.scan();
    }, 3000);
  }

  private async scan() {
    // One transcript per live session — scanned straight off disk. Bypasses
    // ~/.claude/sessions/<pid>.json which freezes at the *initial* sessionId
    // and doesn't follow Claude Code's internal rotations (e.g. auto-compact
    // creating a new jsonl under a fresh id while the same pid keeps running).
    const live = Object.values(this.sm.sessions).filter(
      (s) => s.status !== "completed" && s.status !== "error",
    );
    await Promise.all(live.map((s) => this.updateSession(s)));
    this.sm.emitUpdate();
  }

  private async updateSession(session: AgentSession) {
    const jsonlPath = await latestJsonlForCwd(session.workingDirectory);
    if (!jsonlPath) return;

    const info = await readSessionInfo(jsonlPath);
    session.sessionFilePath = jsonlPath;
    if (info.model) session.modelName = info.model;
    if (info.sessionName && !session.sessionName) session.sessionName = info.sessionName;
    if (info.agentColor && !session.agentColor) session.agentColor = info.agentColor;

    // Exact live count — matches claude-code-leak/src/utils/context.ts's
    // `calculateContextPercentages`: last message's
    // input + cache_creation + cache_read. No 0.85 multiplier, no heuristic.
    session.contextTokens = info.usedTokens;
    session.maxContextTokens = maxTokens(info.model ?? "");
  }
}

function encodeCwd(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

/** Cache per cwd: we avoid re-statting every .jsonl on every scan. On APFS
 *  the project dir's mtime bumps only when entries are added/removed (i.e. on
 *  Claude Code's session rotation), not when an existing file's content grows.
 *  So dir-mtime unchanged ⇒ the previously-latest file is still latest. */
const latestJsonlCache = new Map<string, { dirMtime: number; latest: string }>();

/** Find the newest .jsonl in ~/.claude/projects/<encoded-cwd>/. Handles Claude
 *  Code's internal session rotation — the live transcript is always whichever
 *  file was most recently written, regardless of its sessionId filename. */
async function latestJsonlForCwd(cwd: string): Promise<string | null> {
  const projectDir = path.join(CLAUDE_DIR, "projects", encodeCwd(cwd));
  let dirStat;
  try {
    dirStat = await fs.stat(projectDir);
  } catch {
    return null;
  }

  const cached = latestJsonlCache.get(cwd);
  if (cached && cached.dirMtime === dirStat.mtimeMs) return cached.latest;

  let entries: string[];
  try {
    entries = await fs.readdir(projectDir);
  } catch {
    return null;
  }

  let best: { path: string; mtime: number } | null = null;
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const full = path.join(projectDir, name);
    try {
      const s = await fs.stat(full);
      if (!best || s.mtimeMs > best.mtime) best = { path: full, mtime: s.mtimeMs };
    } catch {
      // skip
    }
  }
  if (!best) return null;

  latestJsonlCache.set(cwd, { dirMtime: dirStat.mtimeMs, latest: best.path });
  return best.path;
}

async function readSessionInfo(jsonlPath: string): Promise<SessionInfo> {
  const info: SessionInfo = { usedTokens: 0 };

  let text: string;
  try {
    const handle = await fs.open(jsonlPath, "r");
    const stat = await handle.stat();
    const readSize = Math.min(stat.size, TAIL_READ_BYTES);
    const buf = Buffer.alloc(readSize);
    await handle.read(buf, 0, readSize, stat.size - readSize);
    await handle.close();
    text = buf.toString("utf-8");
  } catch {
    return info;
  }

  // Walk the tail in reverse — the last message's usage is the live count.
  const lines = text.split("\n").reverse();
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (!info.agentColor && obj.type === "agent-color" && obj.agentColor) {
      info.agentColor = obj.agentColor;
    }
    if (!info.sessionName) {
      if (obj.type === "custom-title" && obj.customTitle) {
        info.sessionName = obj.customTitle;
      } else if (obj.type === "agent-name" && obj.agentName) {
        info.sessionName = obj.agentName;
      } else if (obj.type === "ai-title" && obj.title) {
        info.sessionName = obj.title;
      }
    }

    const msg = obj.message;
    if (!info.model && msg?.model) info.model = msg.model;

    if (info.usedTokens === 0 && msg?.usage) {
      const u = msg.usage;
      const input = u.input_tokens ?? 0;
      const cacheRead = u.cache_read_input_tokens ?? 0;
      const cacheCreate = u.cache_creation_input_tokens ?? 0;
      info.usedTokens = input + cacheRead + cacheCreate;
    }

    // agentColor is rare in the tail — don't block the early-exit on it, or
    // sessions without a color force us to read the full 64KB every scan.
    if (info.usedTokens > 0 && info.model) break;
  }

  return info;
}

function maxTokens(model: string): number {
  if (AUTO_COMPACT_OVERRIDE > 0) return AUTO_COMPACT_OVERRIDE;
  const m = model.toLowerCase();
  if (m.includes("opus")) return 1_000_000;
  if (m.includes("sonnet")) return 200_000;
  if (m.includes("haiku")) return 200_000;
  return 200_000;
}
