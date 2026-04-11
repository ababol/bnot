import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import type { SessionManager } from "./session-manager.js";

const exec = promisify(execFile);
const CLAUDE_DIR = path.join(os.homedir(), ".claude");

interface SessionInfo {
  model?: string;
  estimatedContext: number;
  title?: string;
  agentColor?: string;
}

export class ContextScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private exactTimer: ReturnType<typeof setInterval> | null = null;
  private sm: SessionManager;
  private exactCounts: Record<string, { used: number; max: number; model: string }> = {};
  private cachedTitles: Record<string, string> = {};
  private namedSessions = new Set<string>();
  private coloredSessions = new Set<string>();

  constructor(sm: SessionManager) {
    this.sm = sm;
  }

  start() {
    // Delay initial scan to let ProcessScanner populate sessions first
    setTimeout(() => {
      this.scan();
      this.fetchExactContexts();
    }, 3000);
    this.timer = setInterval(() => this.scan(), 3000);
    this.exactTimer = setInterval(() => this.fetchExactContexts(), 60000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.exactTimer) clearInterval(this.exactTimer);
  }

  private async scan() {
    const sessionsDir = path.join(CLAUDE_DIR, "sessions");
    let files: string[];
    try {
      files = await fs.readdir(sessionsDir);
    } catch {
      return;
    }

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const data = await fs.readFile(path.join(sessionsDir, file), "utf-8");
        const meta = JSON.parse(data);
        const { pid, sessionId, cwd, name: sessionName } = meta;
        if (!pid || !sessionId || !cwd) continue;

        // Check if process is still alive
        try {
          process.kill(pid, 0);
        } catch {
          continue;
        }

        const projectKey = cwd.replace(/[/.]/g, "-");
        const jsonlPath = path.join(CLAUDE_DIR, "projects", projectKey, `${sessionId}.jsonl`);
        try {
          await fs.access(jsonlPath);
        } catch {
          continue;
        }

        const info = await this.readSessionInfo(jsonlPath);
        const procId = `proc-${pid}`;

        // Find matching session
        const matchingEntry = Object.entries(this.sm.sessions).find(
          ([k, v]) => !k.startsWith("proc-") && v.workingDirectory === cwd,
        );
        const matchingId = matchingEntry?.[0] ?? procId;
        const targetId = this.sm.sessions[matchingId]
          ? matchingId
          : this.sm.sessions[procId]
            ? procId
            : null;
        if (!targetId) continue;

        const maxCtx = maxTokens(info.model ?? "");
        this.sm.sessions[targetId].modelName = info.model;
        this.sm.sessions[targetId].sessionFilePath = jsonlPath;

        if (sessionName) {
          this.sm.sessions[targetId].sessionName = sessionName;
        } else if (!this.namedSessions.has(sessionId)) {
          const autoName = await this.autoNameSession(
            path.join(sessionsDir, file),
            jsonlPath,
          );
          if (autoName) {
            this.sm.sessions[targetId].sessionName = autoName;
            this.namedSessions.add(sessionId);
          }
        }
        if (info.title) {
          this.sm.sessions[targetId].taskName = info.title;
        }
        if (info.agentColor) {
          this.sm.sessions[targetId].agentColor = info.agentColor;
        } else if (!this.coloredSessions.has(sessionId)) {
          // Auto-set color to match buddy's identity color
          const suffix = this.sm.sessions[targetId].gitWorktree
            ?? this.sm.sessions[targetId].gitBranch ?? "";
          const buddyColor = hashToClaudeColor(
            this.sm.sessions[targetId].workingDirectory + suffix,
          );
          try {
            const entry = JSON.stringify({
              type: "agent-color",
              agentColor: buddyColor,
              sessionId,
            });
            await fs.appendFile(jsonlPath, entry + "\n");
            this.sm.sessions[targetId].agentColor = buddyColor;
            this.coloredSessions.add(sessionId);
          } catch {
            // write failed, try again next scan
          }
        }

        // Use exact count if available, otherwise estimation
        const exact = this.exactCounts[sessionId];
        if (exact) {
          this.sm.sessions[targetId].contextTokens = exact.used;
          this.sm.sessions[targetId].maxContextTokens = exact.max;
        } else {
          this.sm.sessions[targetId].maxContextTokens = maxCtx;
          this.sm.sessions[targetId].contextTokens = info.estimatedContext;
        }
      } catch {
        // Skip malformed session files
      }
    }

    this.sm.emitUpdate();
  }

  private async readSessionInfo(jsonlPath: string): Promise<SessionInfo> {
    const info: SessionInfo = { estimatedContext: 0 };

    // Read title (cached)
    if (this.cachedTitles[jsonlPath]) {
      info.title = this.cachedTitles[jsonlPath];
    } else {
      info.title = await this.readTitle(jsonlPath);
      if (info.title) this.cachedTitles[jsonlPath] = info.title;
    }

    // Read last 64KB for usage estimation
    let text: string;
    try {
      const handle = await fs.open(jsonlPath, "r");
      const stat = await handle.stat();
      const readSize = Math.min(stat.size, 65536);
      const buf = Buffer.alloc(readSize);
      await handle.read(buf, 0, readSize, stat.size - readSize);
      await handle.close();
      text = buf.toString("utf-8");
    } catch {
      return info;
    }

    const lines = text.split("\n").reverse();
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      // Detect /color setting
      if (!info.agentColor && obj.type === "agent-color" && obj.agentColor) {
        info.agentColor = obj.agentColor;
      }

      const msg = obj.message;
      if (!info.model && msg?.model) {
        info.model = msg.model;
      }

      if (info.estimatedContext === 0 && msg?.usage) {
        const usage = msg.usage;
        const input = usage.input_tokens ?? 0;
        const cacheRead = usage.cache_read_input_tokens ?? 0;
        const cacheCreate = usage.cache_creation_input_tokens ?? 0;
        const rawTotal = input + cacheRead + cacheCreate;

        if (rawTotal > 0) {
          const maxCtx = maxTokens(info.model ?? "");
          if (rawTotal <= maxCtx) {
            info.estimatedContext = Math.floor(rawTotal * 0.85);
          } else {
            const overRatio = rawTotal / maxCtx;
            const fillPercent = Math.max(0.3, Math.min(0.7, 1.0 / overRatio + 0.08));
            info.estimatedContext = Math.floor(maxCtx * fillPercent);
          }
        }
      }

      if (info.estimatedContext > 0 && info.model && info.agentColor) break;
    }

    return info;
  }

  private async readTitle(jsonlPath: string): Promise<string | undefined> {
    let text: string;
    try {
      const handle = await fs.open(jsonlPath, "r");
      const stat = await handle.stat();
      const readSize = Math.min(stat.size, 65536);
      const buf = Buffer.alloc(readSize);
      await handle.read(buf, 0, readSize, stat.size - readSize);
      await handle.close();
      text = buf.toString("utf-8");
    } catch {
      return undefined;
    }

    const lines = text.split("\n").reverse();
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      const branch = obj.gitBranch;
      if (branch && typeof branch === "string") {
        const cwd = (obj.cwd as string) ?? "";
        const repo = cwd.split("/").pop() ?? "";
        return repo ? `${repo}/${branch}` : branch;
      }
    }

    return undefined;
  }

  private async autoNameSession(metaPath: string, jsonlPath: string): Promise<string | undefined> {
    const STOP_WORDS = new Set([
      "i", "want", "to", "a", "the", "can", "you", "please", "me", "help",
      "with", "this", "my", "for", "in", "on", "is", "it", "do", "an",
      "of", "and", "that", "be", "have", "we", "need", "would", "like",
    ]);

    let text: string;
    try {
      const handle = await fs.open(jsonlPath, "r");
      const buf = Buffer.alloc(8192);
      const { bytesRead } = await handle.read(buf, 0, 8192, 0);
      await handle.close();
      text = buf.toString("utf-8", 0, bytesRead);
    } catch {
      return undefined;
    }

    const lines = text.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      const msg = obj.message ?? obj;
      if (msg.role !== "user") continue;

      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .filter((c: { type: string }) => c.type === "text")
          .map((c: { text: string }) => c.text)
          .join(" ");
      }
      if (!content) continue;

      const words = content
        .replace(/[^a-zA-Z0-9\s]/g, " ")
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0)
        .map((w) => w.toLowerCase());

      const meaningful = words.filter((w) => !STOP_WORDS.has(w));
      const slug = (meaningful.length >= 2 ? meaningful : words)
        .slice(0, 5)
        .join("-")
        .slice(0, 50);

      if (!slug) continue;

      // Write name to session metadata so Claude Code picks it up too
      try {
        const data = await fs.readFile(metaPath, "utf-8");
        const meta = JSON.parse(data);
        meta.name = slug;
        await fs.writeFile(metaPath, JSON.stringify(meta));
      } catch {
        // still return the name for display even if write fails
      }

      return slug;
    }

    return undefined;
  }

  private async fetchExactContexts() {
    const sessionsDir = path.join(CLAUDE_DIR, "sessions");
    let files: string[];
    try {
      files = await fs.readdir(sessionsDir);
    } catch {
      return;
    }

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const data = await fs.readFile(path.join(sessionsDir, file), "utf-8");
        const meta = JSON.parse(data);
        const { pid, sessionId, cwd } = meta;
        if (!pid || !sessionId || !cwd) continue;

        try {
          process.kill(pid, 0);
        } catch {
          continue;
        }

        this.queryExactContext(sessionId, cwd);
      } catch {
        // ignore
      }
    }
  }

  private async queryExactContext(sessionId: string, cwd: string) {
    try {
      const { stdout } = await exec(
        "claude",
        [
          "--print",
          "/context",
          "--output-format",
          "json",
          "--resume",
          sessionId,
          "--no-session-persistence",
        ],
        { cwd, timeout: 10000, env: process.env },
      );

      const jsonStart = stdout.indexOf("{");
      if (jsonStart === -1) return;
      const obj = JSON.parse(stdout.substring(jsonStart));
      const resultText: string = obj.result ?? "";

      const tokenMatch = resultText.match(
        /([\d.]+)k?\s*\/\s*([\d.]+)([km])\s*tokens?\s*\((\d+)%\)/i,
      );
      if (!tokenMatch) return;

      const used = Math.floor(parseFloat(tokenMatch[1]) * 1000);
      const maxUnit = tokenMatch[3].toLowerCase();
      const maxVal = parseFloat(tokenMatch[2]) * (maxUnit === "m" ? 1_000_000 : 1_000);

      let model = "";
      const modelMatch = resultText.match(/\*\*Model:\*\*\s*([\w.-]+)/);
      if (modelMatch) model = modelMatch[1];

      if (used > 0 && maxVal > 0) {
        this.exactCounts[sessionId] = { used, max: maxVal, model };
      }
    } catch {
      // Timeout or claude not found — skip
    }
  }
}

function maxTokens(model: string): number {
  const m = model.toLowerCase();
  if (m.includes("opus")) return 1_000_000;
  if (m.includes("sonnet")) return 200_000;
  if (m.includes("haiku")) return 200_000;
  return 200_000;
}

// Claude Code /color accepts: red, blue, green, yellow, purple, orange, pink, cyan
const CLAUDE_COLORS = [
  "green", "blue", "orange", "cyan", "purple", "pink", "yellow", "red",
];

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function hashToClaudeColor(id: string): string {
  return CLAUDE_COLORS[djb2(id) % CLAUDE_COLORS.length];
}
