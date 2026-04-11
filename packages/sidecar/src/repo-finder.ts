import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";

const exec = promisify(execFile);

const RUNTIME_DIR = path.join(os.homedir(), ".buddy-notch");
const CONFIG_PATH = path.join(RUNTIME_DIR, "config.json");

interface RepoEntry {
  localPath: string;
  remotes: { name: string; owner: string; repo: string }[];
}

interface Config {
  projectDirectories: string[];
}

export class RepoFinder {
  private cache = new Map<string, RepoEntry>();
  private cacheTime = 0;
  private readonly CACHE_TTL = 60_000;

  async findRepo(owner: string, repo: string): Promise<string | null> {
    await this.ensureCache();

    const key = `${owner}/${repo}`.toLowerCase();

    // Direct match by remote owner/repo
    for (const entry of this.cache.values()) {
      if (
        entry.remotes.some(
          (r) =>
            r.owner.toLowerCase() === owner.toLowerCase() &&
            r.repo.toLowerCase() === repo.toLowerCase(),
        )
      ) {
        return entry.localPath;
      }
    }

    return null;
  }

  private async ensureCache(): Promise<void> {
    if (Date.now() - this.cacheTime < this.CACHE_TTL && this.cache.size > 0) {
      return;
    }
    await this.scan();
  }

  async scan(): Promise<void> {
    const config = this.readConfig();
    this.cache.clear();

    for (const dir of config.projectDirectories) {
      const expanded = dir.replace(/^~/, os.homedir());
      if (!fs.existsSync(expanded)) continue;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(expanded, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const fullPath = path.join(expanded, entry.name);
        const gitDir = path.join(fullPath, ".git");
        if (!fs.existsSync(gitDir)) continue;

        try {
          const remotes = await this.getRemotes(fullPath);
          if (remotes.length > 0) {
            this.cache.set(fullPath, { localPath: fullPath, remotes });
          }
        } catch {
          // Skip repos we can't read
        }
      }
    }

    this.cacheTime = Date.now();
    process.stderr.write(
      `[repo-finder] scanned ${this.cache.size} repos\n`,
    );
  }

  private async getRemotes(
    repoPath: string,
  ): Promise<{ name: string; owner: string; repo: string }[]> {
    const { stdout } = await exec("git", ["-C", repoPath, "remote", "-v"], {
      timeout: 5000,
    });

    const remotes: { name: string; owner: string; repo: string }[] = [];
    const seen = new Set<string>();

    for (const line of stdout.split("\n")) {
      if (!line.includes("(fetch)")) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;

      const name = parts[0];
      const url = parts[1];
      const parsed = parseGitRemoteUrl(url);
      if (parsed) {
        const key = `${name}:${parsed.owner}/${parsed.repo}`;
        if (!seen.has(key)) {
          seen.add(key);
          remotes.push({ name, ...parsed });
        }
      }
    }

    return remotes;
  }

  private readConfig(): Config {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.projectDirectories)) {
        return parsed as Config;
      }
    } catch {
      // Config doesn't exist or is invalid — create default
    }

    const defaultConfig: Config = {
      projectDirectories: ["~/Code", "~/Projects", "~/Developer", "~/src"],
    };

    try {
      fs.mkdirSync(RUNTIME_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2) + "\n");
      process.stderr.write(`[repo-finder] created default config at ${CONFIG_PATH}\n`);
    } catch {
      // Non-fatal
    }

    return defaultConfig;
  }
}

function parseGitRemoteUrl(
  url: string,
): { owner: string; repo: string } | null {
  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(
    /git@github\.com:([^/]+)\/([^/\s]+?)(?:\.git)?$/,
  );
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(
    /github\.com\/([^/]+)\/([^/\s]+?)(?:\.git)?$/,
  );
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  return null;
}
