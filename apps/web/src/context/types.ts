export type SessionStatus = "active" | "waitingApproval" | "waitingAnswer" | "completed" | "error";
export type SessionMode = "normal" | "plan" | "auto" | "dangerous";

export type PanelState = "compact" | "overview" | "approval" | "ask" | "jump";

export interface ApprovalRequest {
  toolName: string;
  filePath?: string;
  input?: string;
  diffPreview?: string;
  receivedAt: number;
}

export interface QuestionRequest {
  question: string;
  options: string[];
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
}

// Derived helpers
export function contextPercent(s: AgentSession): number {
  if (s.maxContextTokens <= 0) return 0;
  return Math.min(s.contextTokens / s.maxContextTokens, 1.0);
}

export function directoryName(s: AgentSession): string {
  return s.workingDirectory.split("/").pop() ?? s.workingDirectory;
}

export function isIdle(s: AgentSession): boolean {
  return s.status === "active" && s.cpuPercent < 2.0;
}
