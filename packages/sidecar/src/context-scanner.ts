import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";
import { CLAUDE_DIR } from "./paths.js";
import type { SessionManager } from "./session-manager.js";

const exec = promisify(execFile);

const INITIAL_SCAN_DELAY_MS = 3000;
const SCAN_INTERVAL_MS = 3000;
const EXACT_QUERY_INTERVAL_MS = 60000;
const TAIL_READ_BYTES = 65536;
const ESTIMATION_RATIO = 0.85;
const OVER_RATIO_OFFSET = 0.08;
const MIN_FILL_PERCENT = 0.3;
const MAX_FILL_PERCENT = 0.7;

interface SessionInfo {
  model?: string;
  estimatedContext: number;
  sessionName?: string; // custom-title > agent-name > ai-title
  agentColor?: string;
}

export class ContextScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private exactTimer: ReturnType<typeof setInterval> | null = null;
  private sm: SessionManager;
  private exactCounts: Record<string, { used: number; max: number; model: string }> = {};

  constructor(sm: SessionManager) {
    this.sm = sm;
  }

  start() {
    // Delay initial scan to let ProcessScanner populate sessions first
    setTimeout(() => {
      this.scan();
      this.fetchExactContexts();
    }, INITIAL_SCAN_DELAY_MS);
    this.timer = setInterval(() => this.scan(), SCAN_INTERVAL_MS);
    this.exactTimer = setInterval(() => this.fetchExactContexts(), EXACT_QUERY_INTERVAL_MS);
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

        // Find matching session: prefer exact sessionId, then claudeSessionId,
        // then processPid, then proc-based ID
        const targetId = this.sm.sessions[sessionId]
          ? sessionId
          : (Object.entries(this.sm.sessions).find(
              ([, v]) => v.claudeSessionId === sessionId,
            )?.[0] ??
            Object.entries(this.sm.sessions).find(([, v]) => v.processPid === pid)?.[0] ??
            (this.sm.sessions[procId] ? procId : null));
        if (!targetId) continue;

        this.sm.sessions[targetId].claudeSessionId = sessionId;

        const maxCtx = maxTokens(info.model ?? "");
        this.sm.sessions[targetId].modelName = info.model;
        this.sm.sessions[targetId].sessionFilePath = jsonlPath;

        // Read name and color from Claude Code's native JSONL entries
        // Priority: metadata name > JSONL name (custom-title > agent-name > ai-title)
        if (sessionName) {
          this.sm.sessions[targetId].sessionName = sessionName;
        } else if (info.sessionName) {
          this.sm.sessions[targetId].sessionName = info.sessionName;
        }
        if (info.agentColor) {
          this.sm.sessions[targetId].agentColor = info.agentColor;
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

    // Read last 64KB for name, color, model, and usage estimation
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

    const lines = text.split("\n").reverse();
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      // Claude Code native entry types (last-wins, reading in reverse)
      if (!info.agentColor && obj.type === "agent-color" && obj.agentColor) {
        info.agentColor = obj.agentColor;
      }
      // Session name priority: custom-title > agent-name > ai-title
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
            info.estimatedContext = Math.floor(rawTotal * ESTIMATION_RATIO);
          } else {
            const overRatio = rawTotal / maxCtx;
            const fillPercent = Math.max(
              MIN_FILL_PERCENT,
              Math.min(MAX_FILL_PERCENT, 1.0 / overRatio + OVER_RATIO_OFFSET),
            );
            info.estimatedContext = Math.floor(maxCtx * fillPercent);
          }
        }
      }

      if (info.estimatedContext > 0 && info.model && info.agentColor) break;
    }

    return info;
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
