export type BuddyColor = "green" | "blue" | "orange" | "cyan";

export const MAIN_COLORS: Record<BuddyColor, string> = {
  green: "rgb(74, 222, 128)", // 0.29, 0.87, 0.50
  blue: "rgb(97, 166, 250)", // 0.38, 0.65, 0.98
  orange: "rgb(250, 173, 87)", // 0.98, 0.68, 0.34
  cyan: "rgb(97, 212, 222)", // 0.38, 0.83, 0.87
};

export const BRIGHT_COLORS: Record<BuddyColor, string> = {
  green: "rgb(128, 255, 166)", // 0.50, 1.0, 0.65
  blue: "rgb(140, 204, 255)", // 0.55, 0.80, 1.0
  orange: "rgb(255, 217, 128)", // 1.0, 0.85, 0.50
  cyan: "rgb(140, 255, 255)", // 0.55, 1.0, 1.0
};

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
