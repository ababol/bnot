import { execFile } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { CONFIG_PATH, RUNTIME_DIR } from "./paths.js";

/**
 * On first launch, serve the userscript over HTTP and open it in the browser.
 * Tampermonkey intercepts .user.js URLs served over HTTP and shows an install dialog.
 * Tracks installation in config so this only happens once.
 */
export function promptUserscriptInstall(): void {
  if (isAlreadyPrompted()) return;

  const scriptPath = findUserscript();
  if (!scriptPath) {
    process.stderr.write("[userscript] script file not found, skipping install prompt\n");
    return;
  }

  let content: string;
  try {
    content = fs.readFileSync(scriptPath, "utf-8");
  } catch {
    return;
  }

  // Start a one-shot HTTP server on a random port
  const server = http.createServer((req, res) => {
    if (req.url === "/buddynotch-worktree.user.js") {
      res.writeHead(200, {
        "Content-Type": "text/javascript",
        "Content-Disposition": "inline",
      });
      res.end(content);

      // Shut down after serving once
      setTimeout(() => server.close(), 2000);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    if (!addr || typeof addr === "string") return;

    const url = `http://127.0.0.1:${addr.port}/buddynotch-worktree.user.js`;
    process.stderr.write(`[userscript] serving at ${url}\n`);

    execFile("/usr/bin/open", [url], () => {
      // Browser opened — server will close after serving
    });

    markPrompted();
  });

  // Safety: close server after 30s regardless
  setTimeout(() => server.close(), 30000);
  server.on("error", () => {});
}

function isAlreadyPrompted(): boolean {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const config = JSON.parse(raw);
    return config.userscriptPrompted === true;
  } catch {
    return false;
  }
}

function markPrompted(): void {
  try {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    } catch {
      // Will create new
    }
    config.userscriptPrompted = true;
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  } catch {
    // Non-fatal
  }
}

function findUserscript(): string | null {
  // Bundled in app Resources (release)
  const exe = process.execPath;
  const bundled = path.resolve(exe, "../../Resources/userscript/buddynotch-worktree.user.js");
  if (fs.existsSync(bundled)) return bundled;

  // Dev: relative to cwd
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "packages/userscript/buddynotch-worktree.user.js"),
    path.join(cwd, "../../packages/userscript/buddynotch-worktree.user.js"),
    // Relative to sidecar source dir
    path.join(cwd, "../userscript/buddynotch-worktree.user.js"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  return null;
}
