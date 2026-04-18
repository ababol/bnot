import type { BnotColor } from "../lib/colors";

export type SessionStatus = "active" | "waitingApproval" | "waitingAnswer" | "completed" | "error";
export type SessionMode = "normal" | "plan" | "auto" | "dangerous";

export const PANEL_STATES = ["compact", "alert", "overview", "approval", "ask"] as const;
export type PanelState = (typeof PANEL_STATES)[number];

export interface NotchGeometry {
  centerX: number;
  topY: number;
  notchWidth: number;
  notchHeight: number;
}

export const STATUS_TEXT_COLORS: Record<SessionStatus, string> = {
  active: "text-bnot-green",
  waitingApproval: "text-bnot-orange",
  waitingAnswer: "text-bnot-cyan",
  completed: "text-bnot-blue",
  error: "text-bnot-red",
};

export const STATUS_BNOT: Record<SessionStatus, BnotColor> = {
  active: "blue",
  waitingApproval: "orange",
  waitingAnswer: "cyan",
  completed: "green",
  error: "orange",
};

export const STATUS_TEXT: Record<SessionStatus, string> = {
  active: "Working...",
  waitingApproval: "Needs approval",
  waitingAnswer: "Asking question",
  completed: "Completed",
  error: "Error",
};

export const MODE_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  plan: { label: "PLAN", bg: "bg-[#1a3a3a]", text: "text-[#6abfbf]" },
  auto: { label: "AUTO", bg: "bg-[#3a3520]", text: "text-[#bfaa5a]" },
  dangerous: { label: "YOLO", bg: "bg-[#3a2020]", text: "text-[#bf6a6a]" },
};

export interface ApprovalRequest {
  toolName: string;
  filePath?: string;
  input?: string;
  diffPreview?: string;
  canRemember?: boolean;
  receivedAt: number;
}

export interface QuestionItem {
  question: string;
  header?: string;
  options: string[];
  optionDescriptions?: string[];
  multiSelect?: boolean;
}

export interface QuestionRequest extends QuestionItem {
  allQuestions?: QuestionItem[];
  receivedAt: number;
}

export interface AgentSession {
  id: string;
  taskName?: string;
  workingDirectory: string;
  terminalApp?: string;
  terminalPid?: number;
  status: SessionStatus;
  startedAt: number;
  lastActivity: number;
  taskStartedAt?: number;
  currentTool?: string;
  currentFilePath?: string;
  isThinking?: boolean;
  pendingApproval?: ApprovalRequest;
  pendingQuestion?: QuestionRequest;
  contextTokens: number;
  maxContextTokens: number;
  modelName?: string;
  sessionFilePath?: string;
  tty?: string;
  processPid?: number;
  processStartedAt?: number;
  cpuPercent: number;
  gitBranch?: string;
  gitWorktree?: string;
  gitRepoName?: string;
  sessionMode?: SessionMode;
  sessionName?: string;
  agentColor?: string;
  claudeSessionId?: string;
}

// History session for resume after restart
export interface HistorySession {
  sessionId: string;
  projectPath: string;
  summary: string;
  firstPrompt: string;
  messageCount: number;
  gitBranch?: string;
  created: string;
  modified: string;
}

// Hook health types (mirrored from sidecar/hook-installer.ts)
export type HookHealthIssue =
  | { kind: "binaryNotFound"; searchedPaths: string[] }
  | { kind: "binaryNotExecutable"; path: string }
  | { kind: "configMalformedJSON"; path: string; error: string }
  | { kind: "hooksMissing"; events: string[] }
  | { kind: "otherHooksPresent"; commands: string[] };

export interface HookHealthReport {
  status: "healthy" | "degraded";
  binaryPath: string | null;
  configPath: string;
  errors: HookHealthIssue[];
  notices: HookHealthIssue[];
}

// Usage stats types (mirrored from sidecar/usage-watcher.ts)
export interface UsageWindow {
  usedPercent: number;
  resetsAt: number; // unix ms
}

export interface UsageSnapshot {
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  cachedAt: number;
}

// Derived helpers

export function contextPercent(s: AgentSession): number {
  if (s.maxContextTokens <= 0) return 0;
  return Math.min(s.contextTokens / s.maxContextTokens, 1.0);
}

export function directoryName(s: AgentSession): string {
  return s.workingDirectory.split("/").pop() ?? s.workingDirectory;
}

export function isWorking(s: AgentSession, _now: number): boolean {
  return s.status === "active" && (s.currentTool != null || s.isThinking === true);
}

export function isIdle(s: AgentSession, now: number): boolean {
  return s.status === "active" && !isWorking(s, now);
}

export function needsAttention(s: AgentSession): boolean {
  return s.status === "waitingApproval" || s.status === "waitingAnswer";
}

export function projectName(s: HistorySession): string {
  return s.projectPath.split("/").pop() ?? s.projectPath;
}
