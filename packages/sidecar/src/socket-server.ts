import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import type { ApprovalResponse, SocketMessage } from "./types.js";

const RUNTIME_DIR = path.join(os.homedir(), ".buddy-notch");
const SOCKET_PATH = path.join(RUNTIME_DIR, "buddy.sock");
const PID_PATH = path.join(RUNTIME_DIR, "buddy.pid");

type MessageHandler = (msg: SocketMessage, clientFd: number) => void;

export class SocketServer {
  private server: net.Server | null = null;
  private clients = new Map<net.Socket, string>(); // socket -> buffer
  private onMessage: MessageHandler;
  private clientSockets = new Map<number, net.Socket>(); // fd -> socket
  private nextClientId = 1;

  constructor(onMessage: MessageHandler) {
    this.onMessage = onMessage;
  }

  start() {
    // Ensure runtime directory
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });

    // Remove stale socket
    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {
      // ignore
    }

    // Write PID file
    fs.writeFileSync(PID_PATH, String(process.pid));

    this.server = net.createServer((socket) => this.handleClient(socket));
    this.server.listen(SOCKET_PATH, () => {
      // Socket ready
    });
    this.server.on("error", (err) => {
      process.stderr.write(`Socket server error: ${err}\n`);
    });
  }

  stop() {
    this.server?.close();
    for (const socket of this.clients.keys()) {
      socket.destroy();
    }
    this.clients.clear();
    this.clientSockets.clear();

    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(PID_PATH);
    } catch {
      // ignore
    }
  }

  sendResponse(response: ApprovalResponse, clientId: number) {
    const socket = this.clientSockets.get(clientId);
    if (socket && !socket.destroyed) {
      socket.write(JSON.stringify(response) + "\n");
    }
  }

  private handleClient(socket: net.Socket) {
    const clientId = this.nextClientId++;
    this.clients.set(socket, "");
    this.clientSockets.set(clientId, socket);

    socket.on("data", (data) => {
      let buffer = (this.clients.get(socket) ?? "") + data.toString();

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.substring(0, newlineIdx);
        buffer = buffer.substring(newlineIdx + 1);

        if (!line.trim()) continue;

        try {
          const msg: SocketMessage = JSON.parse(line);
          this.onMessage(msg, clientId);
        } catch {
          // Invalid JSON line
        }
      }

      this.clients.set(socket, buffer);
    });

    socket.on("close", () => {
      this.clients.delete(socket);
      this.clientSockets.delete(clientId);
    });

    socket.on("error", () => {
      this.clients.delete(socket);
      this.clientSockets.delete(clientId);
    });
  }
}
