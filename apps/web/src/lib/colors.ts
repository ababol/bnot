// Agent colors — matches Claude Code's dark theme palette
export type BuddyColor =
  | "red"
  | "blue"
  | "green"
  | "yellow"
  | "purple"
  | "orange"
  | "pink"
  | "cyan"
  | "gray";

// Claude Code daltonism-friendly dark theme values
export const BUDDY_COLORS_RGB: Record<BuddyColor, string> = {
  red: "rgb(255, 102, 102)",
  blue: "rgb(102, 178, 255)",
  green: "rgb(102, 255, 102)",
  yellow: "rgb(255, 255, 102)",
  purple: "rgb(178, 102, 255)",
  orange: "rgb(255, 178, 102)",
  pink: "rgb(255, 153, 204)",
  cyan: "rgb(102, 204, 204)",
  gray: "rgb(120, 120, 130)",
};

// --- Unique buddy traits ---

export type BuddyHat = "none" | "cap" | "horn" | "crown";
export type BuddyEars = "both" | "left" | "right" | "floppy";
export type BuddyEyes = "normal" | "winkLeft" | "winkRight";

export interface BuddyTraits {
  color: BuddyColor;
  hat: BuddyHat;
  ears: BuddyEars;
  eyes: BuddyEyes;
}

const HATS: BuddyHat[] = ["none", "cap", "horn", "crown"];
const EARS: BuddyEars[] = ["both", "left", "right", "floppy"];
const EYES: BuddyEyes[] = ["normal", "winkLeft", "winkRight"];

// Must match Claude Code's AGENT_COLORS
const BUDDY_COLORS: BuddyColor[] = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "pink",
  "cyan",
];

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const HAT_KEYWORDS: [string[], BuddyHat][] = [
  [["feat", "feature", "add", "new", "build"], "cap"],
  [["fix", "bug", "hotfix", "patch", "issue"], "horn"],
  [["design", "ui", "style", "css", "art", "frontend"], "crown"],
  [["refactor", "clean", "chore", "perf", "optim"], "none"],
];

function hatFromKeywords(branch: string): BuddyHat | null {
  const lower = branch.toLowerCase();
  for (const [keywords, hat] of HAT_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return hat;
  }
  return null;
}

export function buddyTraitsFromId(id: string, branch?: string): BuddyTraits {
  const h = djb2(id);
  return {
    color: BUDDY_COLORS[h % BUDDY_COLORS.length],
    hat: (branch ? hatFromKeywords(branch) : null) ?? HATS[(h >> 4) % HATS.length],
    ears: EARS[(h >> 8) % EARS.length],
    eyes: EYES[(h >> 12) % EYES.length],
  };
}

const BUDDY_COLOR_SET = new Set<string>(Object.keys(BUDDY_COLORS_RGB));

export function parseBuddyColor(value: string | undefined): BuddyColor | undefined {
  if (value && BUDDY_COLOR_SET.has(value)) return value as BuddyColor;
  return undefined;
}

// --- Status dot ---

export type StatusDot = "working" | "planning" | "waiting" | "idle";

export const STATUS_DOT_COLORS: Record<StatusDot, string> = {
  working: "rgb(102, 255, 102)", // green
  planning: "rgb(102, 204, 204)", // cyan
  waiting: "rgb(255, 255, 102)", // yellow
  idle: "rgb(120, 120, 130)", // gray
};

export function sessionStatusDot(
  status: string,
  isWorking: boolean,
  sessionMode?: string,
): StatusDot {
  if (status === "waitingApproval" || status === "waitingAnswer") return "waiting";
  if (sessionMode === "plan") return "planning";
  if (isWorking) return "working";
  return "idle";
}

/** Buddy body color based on context fill percent: green -> yellow -> red */
export function contextColor(percent: number): string {
  if (percent > 0.85) return "rgb(255, 102, 102)"; // red
  if (percent > 0.6) return "rgb(255, 255, 102)"; // yellow
  return "rgb(102, 255, 102)"; // green
}

export function buddyColorFromSessions(sessions: Record<string, { status: string }>): BuddyColor {
  const vals = Object.values(sessions);
  if (vals.some((s) => s.status === "waitingApproval")) return "orange";
  if (vals.some((s) => s.status === "waitingAnswer")) return "cyan";
  if (vals.some((s) => s.status === "active")) return "blue";
  return "green";
}

/** Lighten a color by blending toward white */
export function lighten(rgb: string, amount = 0.4): string {
  const m = rgb.match(/(\d+)/g);
  if (!m || m.length < 3) return rgb;
  const [r, g, b] = m.map(Number);
  return `rgb(${Math.round(r + (255 - r) * amount)}, ${Math.round(g + (255 - g) * amount)}, ${Math.round(b + (255 - b) * amount)})`;
}
