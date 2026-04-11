import { ContextScanner } from "./context-scanner.js";
import { HistoryScanner } from "./history-scanner.js";
import { installHooksIfNeeded } from "./hook-installer.js";
import { emit, onRequest } from "./ipc.js";
import { ProcessScanner } from "./process-scanner.js";
import { RepoFinder } from "./repo-finder.js";
import { resumeSession } from "./session-launcher.js";
import { SessionManager } from "./session-manager.js";
import { SocketServer } from "./socket-server.js";
import { jumpToSession } from "./terminal-jumper.js";
import { promptUserscriptInstall } from "./userscript-installer.js";
import { WorktreeCreator } from "./worktree-creator.js";

const sm = new SessionManager();
const repoFinder = new RepoFinder();
const worktreeCreator = new WorktreeCreator(repoFinder);
const socketServer = new SocketServer((msg, clientFd) => {
  sm.handleMessage(msg, clientFd);
});
const processScanner = new ProcessScanner(sm);
const contextScanner = new ContextScanner(sm);
const historyScanner = new HistoryScanner();

// Handle IPC requests from Tauri
onRequest(async (method, params) => {
  switch (method) {
    case "getStatus":
      return {
        sessions: sm.sessions,
        heroId: sm.heroSessionId,
      };

    case "jumpToSession": {
      const sessionId = params?.sessionId as string;
      const session = sm.sessions[sessionId];
      if (session) {
        jumpToSession(session);
      }
      return { success: true, sessionId };
    }

    case "approveSession": {
      const sessionId = params?.sessionId as string;
      const clientFd = sm.pendingApprovalClients[sessionId];
      if (clientFd !== undefined) {
        socketServer.sendResponse({ action: "allow" }, clientFd);
        if (sm.sessions[sessionId]) {
          sm.sessions[sessionId].pendingApproval = undefined;
          sm.sessions[sessionId].status = "active";
        }
        delete sm.pendingApprovalClients[sessionId];
        sm.emitUpdate();
      }
      return { success: true };
    }

    case "denySession": {
      const sessionId = params?.sessionId as string;
      const clientFd = sm.pendingApprovalClients[sessionId];
      if (clientFd !== undefined) {
        socketServer.sendResponse({ action: "deny" }, clientFd);
        if (sm.sessions[sessionId]) {
          sm.sessions[sessionId].pendingApproval = undefined;
          sm.sessions[sessionId].status = "active";
        }
        delete sm.pendingApprovalClients[sessionId];
        sm.emitUpdate();
      }
      return { success: true };
    }

    case "openWorktree": {
      const result = await worktreeCreator.open({
        owner: params?.owner as string,
        repo: params?.repo as string,
        branch: params?.branch as string,
        headOwner: params?.headOwner as string,
        headRepo: params?.headRepo as string,
      });
      return result;
    }

    case "resumeSession": {
      const sessionId = params?.sessionId as string;
      const projectPath = params?.projectPath as string;
      await resumeSession(sessionId, projectPath);
      return { success: true };
    }

    default:
      throw new Error(`Unknown method: ${method}`);
  }
});

// Startup
repoFinder.scan().catch((e) => process.stderr.write(`[repo-finder] initial scan error: ${e}\n`));
socketServer.start();
processScanner.start();
contextScanner.start();
historyScanner.start();
installHooksIfNeeded().catch((e) => process.stderr.write(`[hookInstaller] error: ${e}\n`));
promptUserscriptInstall();

// Heartbeat
setInterval(() => {
  emit("heartbeat", { ts: Date.now() });
}, 5000);

// Cleanup on exit
process.on("SIGTERM", () => {
  processScanner.stop();
  contextScanner.stop();
  historyScanner.stop();
  socketServer.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  processScanner.stop();
  contextScanner.stop();
  historyScanner.stop();
  socketServer.stop();
  process.exit(0);
});

process.stderr.write("[sidecar] started\n");
