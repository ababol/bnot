import { execFile } from "child_process";
import { promisify } from "util";
import { emit } from "./ipc.js";
import { RepoFinder } from "./repo-finder.js";

const exec = promisify(execFile);

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
  constructor(private repoFinder: RepoFinder) {}

  async open(
    req: WorktreeRequest,
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    process.stderr.write(
      `[worktree] request: ${req.headOwner}/${req.headRepo}#${req.branch}\n`,
    );

    // 1. Find local repo
    let repoPath = await this.repoFinder.findRepo(
      req.headOwner,
      req.headRepo,
    );
    if (!repoPath) {
      repoPath = await this.repoFinder.findRepo(req.owner, req.repo);
    }
    if (!repoPath) {
      const msg = `Repository ${req.owner}/${req.repo} not found locally`;
      process.stderr.write(`[worktree] ${msg}\n`);
      emit("worktreeStatus", { status: "error", message: msg });
      return { success: false, error: msg };
    }

    process.stderr.write(`[worktree] found repo at ${repoPath}\n`);

    // 2. Check existing worktrees for this branch
    const existing = await this.findExistingWorktree(repoPath, req.branch);
    if (existing) {
      process.stderr.write(
        `[worktree] existing worktree found at ${existing.path}\n`,
      );
      await openTerminal(existing.path);
      emit("worktreeStatus", {
        status: "success",
        message: `Opened existing worktree: ${existing.branch}`,
        path: existing.path,
      });
      return { success: true, path: existing.path };
    }

    // 3. Handle fork: ensure remote exists
    const isFork =
      req.headOwner.toLowerCase() !== req.owner.toLowerCase();
    let remote = "origin";

    if (isFork) {
      remote = req.headOwner;
      const hasRemote = await this.hasRemote(repoPath, remote);
      if (!hasRemote) {
        process.stderr.write(
          `[worktree] adding fork remote: ${remote}\n`,
        );
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
      process.stderr.write(
        `[worktree] fetching ${remote}/${req.branch}\n`,
      );
      await exec(
        "git",
        ["-C", repoPath, "fetch", remote, req.branch],
        { timeout: 30000 },
      );
    } catch (err) {
      const msg = `Failed to fetch ${remote}/${req.branch}: ${err}`;
      process.stderr.write(`[worktree] ${msg}\n`);
      emit("worktreeStatus", { status: "error", message: msg });
      return { success: false, error: msg };
    }

    // 5. Create worktree
    const dirName = sanitizeBranchName(req.branch);
    const worktreePath = `${repoPath}/.claude/worktrees/${dirName}`;

    try {
      process.stderr.write(
        `[worktree] creating at ${worktreePath}\n`,
      );
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

    // 6. Open terminal
    await openTerminal(worktreePath);
    emit("worktreeStatus", {
      status: "success",
      message: `Worktree created: ${dirName}`,
      path: worktreePath,
    });
    return { success: true, path: worktreePath };
  }

  private async findExistingWorktree(
    repoPath: string,
    branch: string,
  ): Promise<WorktreeInfo | null> {
    try {
      const { stdout } = await exec(
        "git",
        ["-C", repoPath, "worktree", "list", "--porcelain"],
        { timeout: 5000 },
      );

      let currentPath = "";
      for (const line of stdout.split("\n")) {
        if (line.startsWith("worktree ")) {
          currentPath = line.slice("worktree ".length);
        } else if (line.startsWith("branch ")) {
          const ref = line.slice("branch ".length); // refs/heads/branch-name
          const branchName = ref.replace("refs/heads/", "");
          // Only match dedicated worktrees (in .claude/worktrees/), not the main repo
          if (branchName === branch && currentPath.includes("/.claude/worktrees/")) {
            return { path: currentPath, branch: branchName };
          }
        }
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  private async hasRemote(
    repoPath: string,
    remoteName: string,
  ): Promise<boolean> {
    try {
      const { stdout } = await exec(
        "git",
        ["-C", repoPath, "remote"],
        { timeout: 5000 },
      );
      return stdout.split("\n").some((r) => r.trim() === remoteName);
    } catch {
      return false;
    }
  }
}

function sanitizeBranchName(branch: string): string {
  return branch
    .replace(/[/\\]/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function detectRunningTerminal(): Promise<string> {
  try {
    const { stdout } = await exec("/bin/ps", ["-eo", "comm"]);
    if (stdout.includes("ghostty")) return "ghostty";
    if (stdout.includes("iTerm")) return "iterm";
    if (stdout.includes("Warp")) return "warp";
    if (stdout.includes("Terminal")) return "terminal";
  } catch {
    // ignore
  }
  return "ghostty";
}

async function openTerminal(dir: string): Promise<void> {
  const terminal = await detectRunningTerminal();

  try {
    if (terminal === "ghostty") {
      await exec("/usr/bin/open", ["-a", "Ghostty", dir]);
    } else if (terminal === "iterm") {
      const script = `
tell application "iTerm2"
  activate
  create window with default profile command "cd ${escapeShell(dir)} && exec $SHELL"
end tell`;
      await exec("/usr/bin/osascript", ["-e", script]);
    } else {
      await exec("/usr/bin/open", ["-a", "Terminal", dir]);
    }
  } catch (err) {
    process.stderr.write(`[worktree] failed to open terminal: ${err}\n`);
  }
}

function escapeShell(s: string): string {
  return s.replace(/'/g, "'\\''");
}
