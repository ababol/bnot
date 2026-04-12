import type { BuddyColor } from "../lib/colors";

export type SessionStatus = "active" | "waitingApproval" | "waitingAnswer" | "completed" | "error";
export type SessionMode = "normal" | "plan" | "auto" | "dangerous";

export type PanelState = "compact" | "alert" | "overview" | "approval" | "ask";

export interface NotchGeometry {
  centerX: number;
  topY: number;
  notchWidth: number;
  notchHeight: number;
}

export const STATUS_TEXT_COLORS: Record<SessionStatus, string> = {
  active: "text-buddy-green",
  waitingApproval: "text-buddy-orange",
  waitingAnswer: "text-buddy-cyan",
  completed: "text-buddy-blue",
  error: "text-buddy-red",
};

export const STATUS_BUDDY: Record<SessionStatus, BuddyColor> = {
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

export interface QuestionRequest {
  question: string;
  header?: string;
  options: string[];
  optionDescriptions?: string[];
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

// Derived helpers

const ACTIVITY_RECENCY_MS = 2_000;

export function contextPercent(s: AgentSession): number {
  if (s.maxContextTokens <= 0) return 0;
  return Math.min(s.contextTokens / s.maxContextTokens, 1.0);
}

export function directoryName(s: AgentSession): string {
  return s.workingDirectory.split("/").pop() ?? s.workingDirectory;
}

export function isWorking(s: AgentSession, now: number): boolean {
  return (
    s.status === "active" &&
    (s.currentTool != null || s.isThinking === true || now - s.lastActivity < ACTIVITY_RECENCY_MS)
  );
}

export function isIdle(s: AgentSession, now: number): boolean {
  return s.status === "active" && !isWorking(s, now);
}

export function projectName(s: HistorySession): string {
  return s.projectPath.split("/").pop() ?? s.projectPath;
}
