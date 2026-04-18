import { execFile, spawn } from "child_process";
import { mkdir, readdir, readFile, rm } from "fs/promises";
import { platform } from "os";
import { basename, dirname, join, resolve as resolvePath } from "path";
import { promisify } from "util";
import { emit } from "./ipc.js";
import { notifyUser } from "./notify.js";
import { WORKTREES_DIR } from "./paths.js";
import { RepoFinder } from "./repo-finder.js";
import { startNewSession } from "./session-launcher.js";
import { SessionManager } from "./session-manager.js";
import { jumpToSession } from "./terminal-jumper.js";

const exec = promisify(execFile);

interface CursorWorktreeConfig {
  "setup-worktree"?: string | string[];
  "setup-worktree-unix"?: string | string[];
  "setup-worktree-windows"?: string | string[];
}

const SETUP_COMMAND_TIMEOUT_MS = 120_000;

export interface WorktreeRequest {
  owner: string;
  repo: string;
  branch: string;
  headOwner: string;
  headRepo: string;
}

interface WorktreeInfo {
  path: string;
  branch: string;
}

export class WorktreeCreator {
  constructor(
    private repoFinder: RepoFinder,
    private sessionManager: SessionManager,
  ) {}

  async open(req: WorktreeRequest): Promise<{ success: boolean; path?: string; error?: string }> {
    process.stderr.write(`[worktree] request: ${req.headOwner}/${req.headRepo}#${req.branch}\n`);

    // Refuse fork branches via deep link: their contents (including
    // .cursor/worktrees.json) would be executed by runCursorSetup, and the
    // fork source is attacker-choosable in a deep-link URL.
    const sameSource =
      req.headOwner.toLowerCase() === req.owner.toLowerCase() &&
      req.headRepo.toLowerCase() === req.repo.toLowerCase();
    if (!sameSource) {
      const msg =
        `Cannot create worktree from fork ${req.headOwner}/${req.headRepo} ` +
        `of ${req.owner}/${req.repo} via deep link.`;
      process.stderr.write(`[worktree] ${msg}\n`);
      emit("worktreeStatus", { status: "error", message: msg });
      return { success: false, error: msg };
    }

    // 1. Find local repo
    let repoPath = await this.repoFinder.findRepo(req.headOwner, req.headRepo);
    if (!repoPath) {
      repoPath = await this.repoFinder.findRepo(req.owner, req.repo);
    }
    if (!repoPath) {
      const msg = `${req.owner}/${req.repo} not found in any project directory configured in ~/.bnot/config.json`;
      process.stderr.write(`[worktree] ${msg}\n`);
      void notifyUser("Bnot: repo not found", msg);
      return { success: false, error: "repo not found" };
    }

    process.stderr.write(`[worktree] found repo at ${repoPath}\n`);

    // 2. Check existing worktrees for this branch
    const existing = await this.findExistingWorktree(repoPath, req.branch);
    if (existing) {
      process.stderr.write(`[worktree] existing worktree found at ${existing.path}\n`);
      await this.launchOrJump(existing.path);
      emit("worktreeStatus", {
        status: "success",
        message: `Opened existing worktree: ${existing.branch}`,
        path: existing.path,
      });
      return { success: true, path: existing.path };
    }

    // 3. Handle fork: ensure remote exists
    const isFork = req.headOwner.toLowerCase() !== req.owner.toLowerCase();
    let remote = "origin";

    if (isFork) {
      remote = req.headOwner;
      const hasRemote = await this.hasRemote(repoPath, remote);
      if (!hasRemote) {
        process.stderr.write(`[worktree] adding fork remote: ${remote}\n`);
        await exec(
          "git",
          [
            "-C",
            repoPath,
            "remote",
            "add",
            remote,
            `https://github.com/${req.headOwner}/${req.headRepo}.git`,
          ],
          { timeout: 10000 },
        );
      }
    }

    // 4. Fetch the branch
    try {
      process.stderr.write(`[worktree] fetching ${remote}/${req.branch}\n`);
      await exec("git", ["-C", repoPath, "fetch", remote, req.branch], { timeout: 30000 });
    } catch (err) {
      const msg = `Failed to fetch ${remote}/${req.branch}: ${err}`;
      process.stderr.write(`[worktree] ${msg}\n`);
      emit("worktreeStatus", { status: "error", message: msg });
      return { success: false, error: msg };
    }

    // 5. Create worktree under ~/.bnot/worktrees/<repo>/<slug>
    const dirName = sanitizeBranchName(req.branch);
    const worktreePath = join(WORKTREES_DIR, basename(repoPath), dirName);

    try {
      await mkdir(dirname(worktreePath), { recursive: true });
      process.stderr.write(`[worktree] creating at ${worktreePath}\n`);
      await exec(
        "git",
        [
          "-C",
          repoPath,
          "worktree",
          "add",
          worktreePath,
          "-B",
          req.branch,
          `${remote}/${req.branch}`,
        ],
        { timeout: 15000 },
      );
    } catch (err) {
      const msg = `Failed to create worktree: ${err}`;
      process.stderr.write(`[worktree] ${msg}\n`);
      emit("worktreeStatus", { status: "error", message: msg });
      return { success: false, error: msg };
    }

    // 5.5 Run Cursor-style setup (best-effort; failures don't abort)
    await this.runCursorSetup(worktreePath, repoPath);

    // 6. Launch claude in worktree (or jump to an active session there)
    await this.launchOrJump(worktreePath);
    emit("worktreeStatus", {
      status: "success",
      message: `Worktree created: ${dirName}`,
      path: worktreePath,
    });
    return { success: true, path: worktreePath };
  }

  async launchOrJump(worktreePath: string): Promise<void> {
    const active = Object.values(this.sessionManager.sessions).find(
      (s) => s.workingDirectory === worktreePath && s.status !== "completed",
    );
    if (active) {
      process.stderr.write(`[worktree] jumping to active session ${active.id}\n`);
      await jumpToSession(active);
    } else {
      process.stderr.write(`[worktree] launching new claude session at ${worktreePath}\n`);
      await startNewSession(worktreePath);
    }
  }

  private async runCursorSetup(worktreePath: string, repoPath: string): Promise<void> {
    const loaded = await loadCursorConfig(worktreePath, repoPath);
    if (!loaded) return;

    const spec = pickSetupSpec(loaded.config);
    if (!spec) {
      process.stderr.write(`[worktree-setup] no setup key for this platform, skipping\n`);
      return;
    }

    const commands = Array.isArray(spec) ? spec : [spec];

    emit("worktreeStatus", {
      status: "settingUp",
      message: `Running setup (${commands.length} step${commands.length === 1 ? "" : "s"})…`,
      path: worktreePath,
    });

    for (const cmd of commands) {
      try {
        await runShellCommand(cmd, worktreePath, repoPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[worktree-setup] command failed: ${msg}\n`);
        emit("worktreeStatus", {
          status: "setupFailed",
          message: `Setup failed: ${msg}`,
          path: worktreePath,
        });
        return;
      }
    }
  }

  private async findExistingWorktree(
    repoPath: string,
    branch: string,
  ): Promise<WorktreeInfo | null> {
    try {
      // Drop admin records for worktree dirs the user deleted on disk, so we
      // don't match a stale path and then fail to cd into it.
      await exec("git", ["-C", repoPath, "worktree", "prune"], { timeout: 5000 }).catch(() => {});

      const { stdout } = await exec("git", ["-C", repoPath, "worktree", "list", "--porcelain"], {
        timeout: 5000,
      });

      const mainPath = resolvePath(repoPath);
      let currentPath = "";
      for (const line of stdout.split("\n")) {
        if (line.startsWith("worktree ")) {
          currentPath = line.slice("worktree ".length);
        } else if (line.startsWith("branch ")) {
          const ref = line.slice("branch ".length); // refs/heads/branch-name
          const branchName = ref.replace("refs/heads/", "");
          if (branchName === branch && resolvePath(currentPath) !== mainPath) {
            if (await hasRealCheckout(currentPath)) {
              return { path: currentPath, branch: branchName };
            }
            process.stderr.write(
              `[worktree] stale/empty worktree at ${currentPath}, will recreate\n`,
            );
            await exec("git", ["-C", repoPath, "worktree", "remove", "--force", currentPath], {
              timeout: 5000,
            }).catch(() => {});
            await rm(currentPath, { recursive: true, force: true }).catch(() => {});
            return null;
          }
        }
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  private async hasRemote(repoPath: string, remoteName: string): Promise<boolean> {
    try {
      const { stdout } = await exec("git", ["-C", repoPath, "remote"], { timeout: 5000 });
      return stdout.split("\n").some((r) => r.trim() === remoteName);
    } catch {
      return false;
    }
  }
}

async function hasRealCheckout(worktreePath: string): Promise<boolean> {
  try {
    const entries = await readdir(worktreePath);
    return entries.some((e) => e !== ".git");
  } catch {
    return false;
  }
}

function sanitizeBranchName(branch: string): string {
  return branch
    .replace(/[/\\]/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function loadCursorConfig(
  worktreePath: string,
  repoPath: string,
): Promise<{ dir: string; config: CursorWorktreeConfig } | null> {
  const candidates = [
    `${worktreePath}/.cursor/worktrees.json`,
    `${repoPath}/.cursor/worktrees.json`,
  ];

  for (const path of candidates) {
    try {
      const raw = await readFile(path, "utf8");
      const config = JSON.parse(raw) as CursorWorktreeConfig;
      process.stderr.write(`[worktree-setup] loaded config from ${path}\n`);
      return { dir: dirname(path), config };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      process.stderr.write(`[worktree-setup] failed to read ${path}: ${err}\n`);
    }
  }
  return null;
}

function pickSetupSpec(config: CursorWorktreeConfig): string | string[] | null {
  const isWindows = platform() === "win32";
  const specific = isWindows ? config["setup-worktree-windows"] : config["setup-worktree-unix"];
  return specific ?? config["setup-worktree"] ?? null;
}

function runShellCommand(command: string, cwd: string, repoPath: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    process.stderr.write(`[worktree-setup] $ ${command}\n`);
    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, ROOT_WORKTREE_PATH: repoPath },
      timeout: SETUP_COMMAND_TIMEOUT_MS,
    });

    const chunks: string[] = [];
    child.stdout?.on("data", (d: Buffer) => chunks.push(d.toString()));
    child.stderr?.on("data", (d: Buffer) => chunks.push(d.toString()));

    child.on("error", reject);
    child.on("close", (code) => {
      const output = chunks.join("");
      if (output) process.stderr.write(`[worktree-setup] ${output.trimEnd()}\n`);
      if (code === 0) {
        resolvePromise();
      } else {
        const tail = output.trim().split("\n").slice(-3).join(" | ");
        reject(new Error(`"${command}" exited with code ${code}${tail ? `: ${tail}` : ""}`));
      }
    });
  });
}
