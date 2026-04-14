import * as os from "os";
import * as path from "path";

export const CLAUDE_DIR = path.join(os.homedir(), ".claude");
export const RUNTIME_DIR = path.join(os.homedir(), ".bnot");
export const CONFIG_PATH = path.join(RUNTIME_DIR, "config.json");
export const SOCKET_PATH = path.join(RUNTIME_DIR, "bnot.sock");
export const PID_PATH = path.join(RUNTIME_DIR, "bnot.pid");
export const USAGE_PATH = path.join(RUNTIME_DIR, "usage.json");
export const STATUSLINE_PATH = path.join(RUNTIME_DIR, "statusline.sh");
export const ctxFilePath = (sessionId: string) => path.join(RUNTIME_DIR, `ctx-${sessionId}.json`);
