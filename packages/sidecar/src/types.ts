// Wire types matching HookEvent.swift

export type MessageType =
  | "preToolUse"
  | "postToolUse"
  | "notification"
  | "sessionStart"
  | "sessionEnd"
  | "stop"
  | "heartbeat";

export interface SocketMessage {
  type: MessageType;
  sessionId: string;
  timestamp: string;
  payload: MessagePayload;
}

export type MessagePayload = {
  preToolUse?: PreToolUsePayload;
  postToolUse?: PostToolUsePayload;
  notification?: NotificationPayload;
  sessionStart?: SessionStartPayload;
  sessionEnd?: SessionEndPayload;
  stop?: StopPayload;
  heartbeat?: boolean;
};

export interface PreToolUsePayload {
  toolName: string;
  filePath?: string;
  input?: string;
  diffPreview?: string;
}

export interface PostToolUsePayload {
  toolName: string;
  filePath?: string;
  wasApproved: boolean;
}

export interface NotificationPayload {
  title: string;
  body: string;
  level: "info" | "warning" | "error" | "success";
}

export interface SessionStartPayload {
  taskName?: string;
  workingDirectory: string;
  terminalApp?: string;
  terminalPid?: number;
}

export interface SessionEndPayload {
  reason?: string;
}

export interface StopPayload {
  reason?: string;
}

export interface ApprovalResponse {
  action: "allow" | "deny";
}

// Session model matching Session.swift
export type SessionStatus = "active" | "waitingApproval" | "waitingAnswer" | "completed" | "error";

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
  pendingApproval?: {
    toolName: string;
    filePath?: string;
    input?: string;
    diffPreview?: string;
    receivedAt: number;
  };
  pendingQuestion?: {
    question: string;
    options: string[];
    receivedAt: number;
  };
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
}

// IPC protocol between Tauri and sidecar
export interface IpcRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface IpcEvent {
  event: string;
  data: unknown;
}

export interface IpcResponse {
  id: number;
  result?: unknown;
  error?: string;
}
