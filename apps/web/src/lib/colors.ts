export type BnotColor =
  | "green"
  | "blue"
  | "orange"
  | "cyan"
  | "gray"
  | "red"
  | "purple"
  | "pink"
  | "yellow"
  | "lime"
  | "white"
  | "lavender";

export const MAIN_COLORS: Record<BnotColor, string> = {
  green: "rgb(74, 222, 128)",
  blue: "rgb(97, 166, 250)",
  orange: "rgb(250, 173, 87)",
  cyan: "rgb(97, 212, 222)",
  gray: "rgb(120, 120, 130)",
  red: "rgb(250, 87, 87)",
  purple: "rgb(180, 130, 255)",
  pink: "rgb(255, 130, 180)",
  yellow: "rgb(250, 230, 90)",
  lime: "rgb(170, 240, 80)",
  white: "rgb(220, 225, 235)",
  lavender: "rgb(160, 170, 255)",
};

export const BRIGHT_COLORS: Record<BnotColor, string> = {
  green: "rgb(128, 255, 166)",
  blue: "rgb(140, 204, 255)",
  orange: "rgb(255, 217, 128)",
  cyan: "rgb(140, 255, 255)",
  gray: "rgb(160, 160, 170)",
  red: "rgb(255, 140, 140)",
  purple: "rgb(210, 170, 255)",
  pink: "rgb(255, 175, 210)",
  yellow: "rgb(255, 245, 150)",
  lime: "rgb(200, 255, 130)",
  white: "rgb(245, 248, 255)",
  lavender: "rgb(195, 200, 255)",
};

// --- Unique bnot traits ---

export type BnotHat = "none" | "cap" | "horn" | "crown";
export type BnotEars = "both" | "left" | "right" | "floppy";
export type BnotEyes = "normal" | "winkLeft" | "winkRight";

export interface BnotTraits {
  color: BnotColor;
  hat: BnotHat;
  ears: BnotEars;
  eyes: BnotEyes;
}

const HATS: BnotHat[] = ["none", "cap", "horn", "crown"];
const EARS: BnotEars[] = ["both", "left", "right", "floppy"];
const EYES: BnotEyes[] = ["normal", "winkLeft", "winkRight"];
const BNOT_COLORS: BnotColor[] = [
  "green",
  "blue",
  "orange",
  "cyan",
  "purple",
  "pink",
  "yellow",
  "lime",
  "white",
  "lavender",
];

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const HAT_KEYWORDS: [string[], BnotHat][] = [
  [["feat", "feature", "add", "new", "build"], "cap"],
  [["fix", "bug", "hotfix", "patch", "issue"], "horn"],
  [["design", "ui", "style", "css", "art", "frontend"], "crown"],
  [["refactor", "clean", "chore", "perf", "optim"], "none"],
];

function hatFromKeywords(branch: string): BnotHat | null {
  const lower = branch.toLowerCase();
  for (const [keywords, hat] of HAT_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return hat;
  }
  return null;
}

export function bnotTraitsFromId(id: string, branch?: string): BnotTraits {
  const h = djb2(id);
  return {
    color: BNOT_COLORS[h % BNOT_COLORS.length],
    hat: (branch ? hatFromKeywords(branch) : null) ?? HATS[(h >> 4) % HATS.length],
    ears: EARS[(h >> 8) % EARS.length],
    eyes: EYES[(h >> 12) % EYES.length],
  };
}

const BNOT_COLOR_SET = new Set<string>([
  "green",
  "blue",
  "orange",
  "cyan",
  "gray",
  "red",
  "purple",
  "pink",
  "yellow",
  "lime",
  "white",
  "lavender",
]);

export function parseBnotColor(value: string | undefined): BnotColor | undefined {
  if (value && BNOT_COLOR_SET.has(value)) return value as BnotColor;
  return undefined;
}

// --- Status dot ---

export type StatusDot = "working" | "planning" | "waiting" | "done" | "idle";

export const STATUS_DOT_COLORS: Record<StatusDot, string> = {
  working: "rgb(97, 166, 250)", // blue
  planning: "rgb(97, 212, 222)", // cyan
  waiting: "rgb(250, 173, 87)", // orange
  done: "rgb(74, 222, 128)", // green
  idle: "rgb(120, 120, 130)", // gray
};

export function sessionStatusDot(
  status: string,
  isWorking: boolean,
  sessionMode?: string,
): StatusDot {
  if (status === "waitingApproval" || status === "waitingAnswer") return "waiting";
  if (status === "completed") return "done";
  if (sessionMode === "plan") return "planning";
  if (isWorking) return "working";
  return "idle";
}

export function bnotColorFromSessions(sessions: Record<string, { status: string }>): BnotColor {
  const vals = Object.values(sessions);
  if (vals.some((s) => s.status === "waitingApproval")) return "orange";
  if (vals.some((s) => s.status === "waitingAnswer")) return "cyan";
  if (vals.some((s) => s.status === "active")) return "blue";
  return "green";
}
