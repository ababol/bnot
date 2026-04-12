// Wire types matching HookEvent.swift

export type MessageType =
  | "preToolUse"
  | "postToolUse"
  | "permissionRequest"
  | "notification"
  | "sessionStart"
  | "sessionEnd"
  | "stop"
  | "heartbeat"
  | "userPromptSubmit";

export interface SocketMessage {
  type: MessageType;
  sessionId: string;
  timestamp: string;
  payload: MessagePayload;
  sessionMode?: string;
}

export type MessagePayload = {
  preToolUse?: PreToolUsePayload;
  postToolUse?: PostToolUsePayload;
  permissionRequest?: PermissionRequestPayload;
  notification?: NotificationPayload;
  sessionStart?: SessionStartPayload;
  sessionEnd?: SessionEndPayload;
  stop?: StopPayload;
  heartbeat?: boolean;
  userPromptSubmit?: UserPromptSubmitPayload;
};

export interface UserPromptSubmitPayload {
  prompt?: string;
}

export interface PreToolUsePayload {
  toolName: string;
  filePath?: string;
  input?: string;
  diffPreview?: string;
  question?: string;
  questionHeader?: string;
  options?: string[];
  optionDescriptions?: string[];
}

export interface PermissionRequestPayload {
  toolName: string;
  filePath?: string;
  input?: string;
  diffPreview?: string;
  canRemember?: boolean;
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
  action: "allow" | "allowAlways" | "deny" | "answer" | "acceptEdits" | "bypassPermissions";
  answerLabel?: string;
  questionText?: string;
  feedback?: string;
}

// Session model matching Session.swift
export type SessionStatus = "active" | "waitingApproval" | "waitingAnswer" | "completed" | "error";
export type SessionMode = "normal" | "plan" | "auto" | "dangerous";

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
  pendingApproval?: {
    toolName: string;
    filePath?: string;
    input?: string;
    diffPreview?: string;
    canRemember?: boolean;
    receivedAt: number;
  };
  pendingQuestion?: {
    question: string;
    header?: string;
    options: string[];
    optionDescriptions?: string[];
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
  sessionMode?: SessionMode;
  sessionName?: string;
  agentColor?: string;
  claudeSessionId?: string;
}

// History session from ~/.claude/projects/*/sessions-index.json
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
