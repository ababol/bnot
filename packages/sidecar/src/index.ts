import * as path from "path";
import { ContextScanner } from "./context-scanner.js";
import { GhosttyFocusWatcher } from "./ghostty-focus-watcher.js";
import { HistoryScanner } from "./history-scanner.js";
import {
  checkHookHealth,
  installHooksIfNeeded,
  installStatusLineIfNeeded,
  installWorktreeHooksIfNeeded,
  repairHooks,
} from "./hook-installer.js";
import { emit, onRequest } from "./ipc.js";
import { WORKTREES_DIR } from "./paths.js";
import { ProcessScanner } from "./process-scanner.js";
import { RepoFinder } from "./repo-finder.js";
import { resumeSession } from "./session-launcher.js";
import { SessionManager } from "./session-manager.js";
import { jumpToSession } from "./terminal-jumper.js";
import type { SocketMessage } from "./types.js";
import { UsageWatcher } from "./usage-watcher.js";
import { WorktreeCreator } from "./worktree-creator.js";
import { WorktreeRegistry } from "./worktree-registry.js";

function requireParam(params: Record<string, unknown> | undefined, key: string): string {
  const val = params?.[key];
  if (typeof val !== "string" || !val) {
    throw new Error(`Missing required parameter: ${key}`);
  }
  return val;
}

function resolveApproval(
  sessionManager: SessionManager,
  sessionId: string,
  action: "allow" | "allowAlways" | "deny" | "acceptEdits" | "bypassPermissions",
  feedback?: string,
) {
  const clientId = sessionManager.pendingApprovalClients[sessionId];
  if (clientId !== undefined) {
    emit("socketResponse", { clientId, response: { action, feedback } });
    if (sessionManager.sessions[sessionId]) {
      sessionManager.sessions[sessionId].pendingApproval = undefined;
      sessionManager.setStatus(sessionId, "active");
    }
    delete sessionManager.pendingApprovalClients[sessionId];
    emit("panelStateChange", { state: "compact" });
    sessionManager.emitUpdate();
  }
}

const sessionManager = new SessionManager();
const repoFinder = new RepoFinder();
const worktreeCreator = new WorktreeCreator(repoFinder, sessionManager);
const usageWatcher = new UsageWatcher();
const CONTEXT_TRIGGERS = new Set([
  "sessionStart",
  "sessionEnd",
  "stop",
  "postToolUse",
  "subagentStop",
  "userPromptSubmit",
]);
const HISTORY_TRIGGERS = new Set(["sessionEnd", "stop"]);
const WORKTREE_TRIGGERS = new Set(["sessionStart", "sessionEnd", "stop"]);
const processScanner = new ProcessScanner(sessionManager);
const contextScanner = new ContextScanner(sessionManager);
const historyScanner = new HistoryScanner();
const worktreeRegistry = new WorktreeRegistry(sessionManager, historyScanner);
const ghosttyFocusWatcher = new GhosttyFocusWatcher(sessionManager);

function handleSocketMessage(clientId: number, msg: SocketMessage) {
  sessionManager.handleMessage(msg, clientId);
  if (CONTEXT_TRIGGERS.has(msg.type)) contextScanner.triggerScan();
  if (HISTORY_TRIGGERS.has(msg.type)) historyScanner.triggerScan();
  if (WORKTREE_TRIGGERS.has(msg.type)) worktreeRegistry.triggerScan();
}

// Handle IPC requests from Tauri
onRequest(async (method, params) => {
  switch (method) {
    case "getStatus":
      return {
        sessions: sessionManager.sessions,
        heroId: sessionManager.heroSessionId,
      };

    case "jumpToSession": {
      const sessionId = requireParam(params, "sessionId");
      const session = sessionManager.sessions[sessionId];
      if (session) {
        jumpToSession(session);
      }
      return { success: true, sessionId };
    }

    case "answerQuestion": {
      const sessionId = requireParam(params, "sessionId");
      const answers = params?.answers as Record<string, string | string[]> | undefined;
      const session = sessionManager.sessions[sessionId];
      if (session?.pendingQuestion) {
        const clientId = sessionManager.pendingApprovalClients[sessionId];
        if (clientId !== undefined) {
          emit("socketResponse", { clientId, response: { action: "answer", answers } });
        }
        session.pendingQuestion = undefined;
        sessionManager.setStatus(sessionId, "active");
        delete sessionManager.pendingApprovalClients[sessionId];
        emit("panelStateChange", { state: "compact" });
        sessionManager.emitUpdate();
      }
      return { success: true };
    }

    case "approveSession": {
      const sessionId = requireParam(params, "sessionId");
      resolveApproval(sessionManager, sessionId, "allow");
      return { success: true };
    }

    case "denySession": {
      const sessionId = requireParam(params, "sessionId");
      const feedback = typeof params?.feedback === "string" ? params.feedback : undefined;
      resolveApproval(sessionManager, sessionId, "deny", feedback);
      return { success: true };
    }

    case "acceptEditsSession": {
      const sessionId = requireParam(params, "sessionId");
      resolveApproval(sessionManager, sessionId, "acceptEdits");
      return { success: true };
    }

    case "bypassPermissionsSession": {
      const sessionId = requireParam(params, "sessionId");
      resolveApproval(sessionManager, sessionId, "bypassPermissions");
      return { success: true };
    }

    case "approveSessionAlways": {
      const sessionId = requireParam(params, "sessionId");
      resolveApproval(sessionManager, sessionId, "allowAlways");
      return { success: true };
    }

    case "socketMessage": {
      const clientId = params?.clientId;
      const message = params?.message;
      if (typeof clientId !== "number" || !message || typeof message !== "object") {
        throw new Error("socketMessage: invalid clientId/message");
      }
      handleSocketMessage(clientId, message as SocketMessage);
      return { success: true };
    }

    case "socketDisconnect": {
      const clientId = params?.clientId;
      if (typeof clientId !== "number") {
        throw new Error("socketDisconnect: invalid clientId");
      }
      sessionManager.handleClientDisconnect(clientId);
      return { success: true };
    }

    case "openWorktree": {
      const result = await worktreeCreator.open({
        owner: requireParam(params, "owner"),
        repo: requireParam(params, "repo"),
        branch: requireParam(params, "branch"),
        headOwner: requireParam(params, "headOwner"),
        headRepo: requireParam(params, "headRepo"),
      });
      return result;
    }

    case "openWorktreePath": {
      const raw = requireParam(params, "path");
      const resolved = path.resolve(raw);
      // Security: only allow paths physically under ~/.bnot/worktrees/
      if (resolved !== WORKTREES_DIR && !resolved.startsWith(WORKTREES_DIR + path.sep)) {
        throw new Error(`openWorktreePath: refused — not under ${WORKTREES_DIR}`);
      }
      await worktreeCreator.launchOrJump(resolved);
      return { success: true };
    }

    case "resumeSession": {
      const sessionId = requireParam(params, "sessionId");
      const projectPath = requireParam(params, "projectPath");
      await resumeSession(sessionId, projectPath);
      return { success: true };
    }

    case "getHookHealth": {
      const report = await checkHookHealth();
      emit("hookHealth", report);
      return report;
    }

    case "repairHooks": {
      const report = await repairHooks();
      emit("hookHealth", report);
      return report;
    }

    default:
      throw new Error(`Unknown method: ${method}`);
  }
});

// Startup
repoFinder
  .scan()
  .catch((err) => process.stderr.write(`[repo-finder] initial scan error: ${err}\n`));
processScanner.start();
contextScanner.start();
historyScanner.start();
worktreeRegistry.start();
ghosttyFocusWatcher.start();
usageWatcher.start();
installHooksIfNeeded()
  .then(() => installStatusLineIfNeeded())
  .then(() => installWorktreeHooksIfNeeded())
  .then(() => checkHookHealth())
  .then((report) => emit("hookHealth", report))
  .catch((err) => process.stderr.write(`[hookInstaller] error: ${err}\n`));

// Heartbeat
setInterval(() => {
  emit("heartbeat", { ts: Date.now() });
}, 5000);

// Cleanup on exit
function cleanup() {
  processScanner.stop();
  contextScanner.stop();
  historyScanner.stop();
  worktreeRegistry.stop();
  ghosttyFocusWatcher.stop();
  usageWatcher.stop();
  process.exit(0);
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);
// Exit when Tauri parent closes stdin (parent died without sending SIGTERM)
process.stdin.on("close", cleanup);

process.stderr.write("[sidecar] started\n");
