import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

interface TabPane {
  tab: number; // 1-based
  pane: number; // 0-based
}

interface ChildInfo {
  pid: number;
  tty: string;
}

export class GhosttyTabMapper {
  private cachedMapping: Record<string, TabPane> = {};
  private lastTabCount = 0;
  private lastChildCount = 0;

  lookup(tty: string): TabPane | null {
    return this.cachedMapping[tty] ?? null;
  }

  async refresh(ghosttyPid: number) {
    const tabCount = await this.getTabCount();
    const children = await this.getChildrenSorted(ghosttyPid);

    if (tabCount <= 0 || children.length === 0) return;

    if (
      tabCount === this.lastTabCount &&
      children.length === this.lastChildCount &&
      Object.keys(this.cachedMapping).length > 0
    ) {
      return;
    }

    this.lastTabCount = tabCount;
    this.lastChildCount = children.length;

    const paneCounts = await this.probePaneCounts(tabCount);
    if (paneCounts.length !== tabCount) return;

    const mapping: Record<string, TabPane> = {};
    let childIdx = 0;
    for (let tabIdx = 0; tabIdx < paneCounts.length; tabIdx++) {
      for (let paneIdx = 0; paneIdx < paneCounts[tabIdx]; paneIdx++) {
        if (childIdx >= children.length) break;
        mapping[children[childIdx].tty] = { tab: tabIdx + 1, pane: paneIdx };
        childIdx++;
      }
    }

    this.cachedMapping = mapping;
  }

  private async getTabCount(): Promise<number> {
    const script = `
tell application "System Events"
  tell process "ghostty"
    return count of radio buttons of tab group 1 of window 1
  end tell
end tell`;

    try {
      const { stdout } = await exec("/usr/bin/osascript", ["-e", script]);
      return Math.max(0, parseInt(stdout.trim()) || 0);
    } catch {
      return 0;
    }
  }

  private async probePaneCounts(tabCount: number): Promise<number[]> {
    const lines = [
      'tell application "System Events"',
      '  tell process "ghostty"',
      "    set tg to tab group 1 of window 1",
      "    set savedTab to 0",
      "    repeat with i from 1 to count of radio buttons of tg",
      "      if value of radio button i of tg is 1 then set savedTab to i",
      "    end repeat",
      '    set counts to ""',
    ];

    for (let i = 1; i <= tabCount; i++) {
      lines.push(
        `    click radio button ${i} of tg`,
        "    delay 0.05",
        "    set paneCount to 0",
        "    set allE to entire contents of window 1",
        "    repeat with e in allE",
        '      if role description of e is "scroll area" then set paneCount to paneCount + 1',
        "    end repeat",
        '    set counts to counts & paneCount & ","',
      );
    }

    lines.push(
      "    if savedTab > 0 then click radio button savedTab of tg",
      "    return counts",
      "  end tell",
      "end tell",
    );

    try {
      const { stdout } = await exec("/usr/bin/osascript", ["-e", lines.join("\n")]);
      return stdout
        .trim()
        .split(",")
        .filter(Boolean)
        .map((s) => parseInt(s.trim()) || 0);
    } catch {
      return [];
    }
  }

  private async getChildrenSorted(parentPid: number): Promise<ChildInfo[]> {
    try {
      const { stdout } = await exec("/bin/ps", ["-eo", "pid,ppid,tty"]);
      const children: ChildInfo[] = [];

      for (const line of stdout.split("\n")) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 3) continue;
        const pid = parseInt(cols[0]);
        const ppid = parseInt(cols[1]);
        const tty = cols[2];
        if (ppid === parentPid && tty !== "??" && tty !== "-") {
          children.push({ pid, tty });
        }
      }

      return children.sort((a, b) => a.pid - b.pid);
    } catch {
      return [];
    }
  }
}
