import * as os from "os";
import * as path from "path";

export const CLAUDE_DIR = path.join(os.homedir(), ".claude");
export const RUNTIME_DIR = path.join(os.homedir(), ".buddy-notch");
export const CONFIG_PATH = path.join(RUNTIME_DIR, "config.json");
export const SOCKET_PATH = path.join(RUNTIME_DIR, "buddy.sock");
export const PID_PATH = path.join(RUNTIME_DIR, "buddy.pid");
