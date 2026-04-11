export type BuddyColor =
  | "green" | "blue" | "orange" | "cyan" | "gray" | "red"
  | "purple" | "pink" | "yellow" | "lime" | "white" | "lavender";

export const MAIN_COLORS: Record<BuddyColor, string> = {
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

export const BRIGHT_COLORS: Record<BuddyColor, string> = {
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
const BUDDY_COLORS: BuddyColor[] = [
  "green", "blue", "orange", "cyan", "purple",
  "pink", "yellow", "lime", "white", "lavender",
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
    hat: (branch && hatFromKeywords(branch)) ?? HATS[(h >> 4) % HATS.length],
    ears: EARS[(h >> 8) % EARS.length],
    eyes: EYES[(h >> 12) % EYES.length],
  };
}

/** Buddy body color based on context fill percent: green -> yellow -> red */
export function contextColor(percent: number): string {
  if (percent > 0.85) return "rgb(255, 51, 51)"; // red: <15% remaining
  if (percent > 0.6) return "rgb(255, 191, 26)"; // yellow: >60% used
  return "rgb(74, 222, 128)"; // green: plenty of space
}

export function buddyColorFromSessions(sessions: Record<string, { status: string }>): BuddyColor {
  const vals = Object.values(sessions);
  if (vals.some((s) => s.status === "waitingApproval")) return "orange";
  if (vals.some((s) => s.status === "waitingAnswer")) return "cyan";
  if (vals.some((s) => s.status === "active")) return "blue";
  return "green";
}
