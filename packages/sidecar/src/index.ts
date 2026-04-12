import { ContextScanner } from "./context-scanner.js";
import { GhosttyFocusWatcher } from "./ghostty-focus-watcher.js";
import { HistoryScanner } from "./history-scanner.js";
import { installHooksIfNeeded } from "./hook-installer.js";
import { emit, onRequest } from "./ipc.js";
import { ProcessScanner } from "./process-scanner.js";
import { RepoFinder } from "./repo-finder.js";
import { resumeSession } from "./session-launcher.js";
import { SessionManager } from "./session-manager.js";
import { SocketServer } from "./socket-server.js";
import { jumpToSession } from "./terminal-jumper.js";
import { WorktreeCreator } from "./worktree-creator.js";

function requireParam(params: Record<string, unknown> | undefined, key: string): string {
  const val = params?.[key];
  if (typeof val !== "string" || !val) {
    throw new Error(`Missing required parameter: ${key}`);
  }
  return val;
}

function resolveApproval(
  sessionManager: SessionManager,
  socketServer: SocketServer,
  sessionId: string,
  action: "allow" | "allowAlways" | "deny" | "acceptEdits" | "bypassPermissions",
  feedback?: string,
) {
  const clientFd = sessionManager.pendingApprovalClients[sessionId];
  if (clientFd !== undefined) {
    socketServer.sendResponse({ action, feedback }, clientFd);
    if (sessionManager.sessions[sessionId]) {
      sessionManager.sessions[sessionId].pendingApproval = undefined;
      sessionManager.sessions[sessionId].status = "active";
    }
    delete sessionManager.pendingApprovalClients[sessionId];
    emit("panelStateChange", { state: "compact" });
    sessionManager.emitUpdate();
  }
}

const sessionManager = new SessionManager();
const repoFinder = new RepoFinder();
const worktreeCreator = new WorktreeCreator(repoFinder);
const socketServer = new SocketServer((msg, clientFd) => {
  sessionManager.handleMessage(msg, clientFd);
});
const processScanner = new ProcessScanner(sessionManager);
const contextScanner = new ContextScanner(sessionManager);
const historyScanner = new HistoryScanner();
const ghosttyFocusWatcher = new GhosttyFocusWatcher(sessionManager);

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
      const optionIndex = typeof params?.optionIndex === "number" ? params.optionIndex : 0;
      const session = sessionManager.sessions[sessionId];
      if (session?.pendingQuestion) {
        const q = session.pendingQuestion;
        const label = q.options[optionIndex] ?? q.options[0] ?? "";
        // Send answer through the socket to the waiting bridge
        const clientFd = sessionManager.pendingApprovalClients[sessionId];
        if (clientFd !== undefined) {
          socketServer.sendResponse(
            { action: "answer", answerLabel: label, questionText: q.question } as never,
            clientFd,
          );
          session.pendingQuestion = undefined;
          session.status = "active";
          delete sessionManager.pendingApprovalClients[sessionId];
          emit("panelStateChange", { state: "compact" });
          sessionManager.emitUpdate();
        }
      }
      return { success: true };
    }

    case "approveSession": {
      const sessionId = requireParam(params, "sessionId");
      resolveApproval(sessionManager, socketServer, sessionId, "allow");
      return { success: true };
    }

    case "denySession": {
      const sessionId = requireParam(params, "sessionId");
      const feedback = typeof params?.feedback === "string" ? params.feedback : undefined;
      resolveApproval(sessionManager, socketServer, sessionId, "deny", feedback);
      return { success: true };
    }

    case "acceptEditsSession": {
      const sessionId = requireParam(params, "sessionId");
      resolveApproval(sessionManager, socketServer, sessionId, "acceptEdits");
      return { success: true };
    }

    case "bypassPermissionsSession": {
      const sessionId = requireParam(params, "sessionId");
      resolveApproval(sessionManager, socketServer, sessionId, "bypassPermissions");
      return { success: true };
    }

    case "approveSessionAlways": {
      const sessionId = requireParam(params, "sessionId");
      resolveApproval(sessionManager, socketServer, sessionId, "allowAlways");
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

    case "resumeSession": {
      const sessionId = requireParam(params, "sessionId");
      const projectPath = requireParam(params, "projectPath");
      await resumeSession(sessionId, projectPath);
      return { success: true };
    }

    default:
      throw new Error(`Unknown method: ${method}`);
  }
});

// Startup
repoFinder
  .scan()
  .catch((err) => process.stderr.write(`[repo-finder] initial scan error: ${err}\n`));
socketServer.start();
processScanner.start();
contextScanner.start();
historyScanner.start();
ghosttyFocusWatcher.start();
installHooksIfNeeded().catch((err) => process.stderr.write(`[hookInstaller] error: ${err}\n`));

// Heartbeat
setInterval(() => {
  emit("heartbeat", { ts: Date.now() });
}, 5000);

// Cleanup on exit
function cleanup() {
  processScanner.stop();
  contextScanner.stop();
  historyScanner.stop();
  ghosttyFocusWatcher.stop();
  socketServer.stop();
  process.exit(0);
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);

process.stderr.write("[sidecar] started\n");
