import * as readline from "readline";
import type { IpcEvent, IpcRequest, IpcResponse } from "./types.js";

type RequestHandler = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

let handler: RequestHandler | null = null;

// Prevent EPIPE crash when Tauri process exits before sidecar
process.stdout.on("error", () => {});

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  if (!handler) return;
  try {
    const req: IpcRequest = JSON.parse(line);
    try {
      const result = await handler(req.method, req.params);
      send({ id: req.id, result } as IpcResponse);
    } catch (err) {
      const errMsg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
      send({ id: req.id, error: errMsg } as IpcResponse);
    }
  } catch {
    // Invalid JSON — ignore
  }
});

export function onRequest(h: RequestHandler) {
  handler = h;
}

export function emit(event: string, data: unknown) {
  send({ event, data } as IpcEvent);
}

function send(msg: IpcResponse | IpcEvent) {
  try {
    process.stdout.write(JSON.stringify(msg) + "\n");
  } catch {
    // Tauri process exited, ignore EPIPE
  }
}
