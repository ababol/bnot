import { useMemo } from "react";
import type { BnotColor } from "../lib/colors";
import { bnotTraitsFromId, MAIN_COLORS } from "../lib/colors";
import type { Phases } from "../lib/demo-state";
import type { Session, Tab } from "../lib/tabs";
import { synthesizeResumedSession, WORKTREE_SESSIONS } from "../lib/tabs";
import PixelBell from "./pixel-bell";
import PixelBnot from "./pixel-bnot";
import StatusIndicator from "./status-indicator";

type Props = {
  tab: Tab;
  phases: Phases;
  resumedBranches: string[];
  focusedTerminalId: string | null;
};

export function CompactNotchLayer({ tab, phases, resumedBranches, focusedTerminalId }: Props) {
  const { contextPercent } = tab.notch;
  // Launch pill counts up 1 → 2 once the GitHub browser fires "Open in worktree".
  const launched = tab.id === "launch" && phases.launch.kind === "launched";
  // Synthesize resumed sessions once per branch-list change — both the
  // session-count helper and the focal picker need them, so doing the work
  // upfront avoids iterating `resumedBranches` + calling
  // `synthesizeResumedSession` twice per render.
  const resumedSessions = useMemo(
    () =>
      resumedBranches
        .map((b) => synthesizeResumedSession(b))
        .filter((s): s is Session => s !== null),
    [resumedBranches],
  );
  // The right-wing number is always the count of *active sessions* — agents
  // the user has running. Worktrees on disk aren't counted; those are the
  // Resume tab's picker grid, not sessions. So Resume pre-click reads "2
  // sessions" (the two always-running WORKTREE_SESSIONS), and each resumed
  // branch that isn't already one of those bumps the count.
  const sessionCount = useMemo(
    () => activeSessionCount(tab, phases.launch.kind === "launched", resumedSessions),
    [tab, phases.launch.kind, resumedSessions],
  );
  const labelText = `${sessionCount} session${sessionCount === 1 ? "" : "s"}`;
  // Approve has three compact-view beats it needs to express: pending (bell +
  // orange), running (blue spinner while the edit applies) and done (green
  // check once the edit lands). The done check is the same StatusIndicator
  // kind the session card uses for `effectiveStatus === "completed"`, so the
  // compact chrome reads as a miniature of what the expanded view was saying.
  const approveKind = tab.id === "approve" ? phases.approve.kind : "idle";
  const hasPendingApproval = tab.id === "approve" && approveKind === "idle";
  const approveWorking = approveKind === "working";
  const approveDone = approveKind === "approved" || approveKind === "always";
  const showBell = hasPendingApproval;

  // The compact PixelBnot reflects whichever session the user most recently
  // interacted with. A focused terminal tab wins over everything else — when
  // the user switches terminals (or clicks a session card, which focuses the
  // terminal and compacts), the buddy should match that session. Fallback
  // order: latest resumed branch, then the tab's scripted focal session.
  const focal = focalAppearance(tab, phases, resumedSessions, focusedTerminalId);
  const focalTraits = useMemo(
    () => bnotTraitsFromId(focal.traitKey, focal.branch),
    [focal.traitKey, focal.branch],
  );

  const barColor =
    contextPercent >= 0.85
      ? MAIN_COLORS.red
      : contextPercent >= 0.6
        ? MAIN_COLORS.orange
        : MAIN_COLORS.green;

  const labelColor = hasPendingApproval
    ? "text-bnot-orange"
    : approveDone
      ? "text-bnot-green"
      : "text-text-muted";

  return (
    <div className="flex items-center gap-2 px-3 h-full w-full select-none">
      {/* Left wing — context bar (height ∝ token usage). Centered vertically
          so it reads as a wing balanced around the PixelBnot, matching the
          real product's compact chrome (not flush with the notch bottom). */}
      <div className="flex h-full items-center">
        <div
          className="w-1 rounded-full"
          style={{
            background: barColor,
            height: `${Math.max(8, Math.round(contextPercent * 22))}px`,
            opacity: 0.85,
          }}
        />
      </div>
      {/* Hero PixelBnot — per-session color + traits, not a per-tab brand color */}
      <PixelBnot color={focal.color} isActive traits={focalTraits} size="sm" />
      {/* Center dead zone (notch hardware) */}
      <div className="w-[70px] shrink-0 max-sm:w-12" />
      {/* Right wing — count + optional bell / working spinner / done check.
          Launch's launched state shows the blue spinner for the newcomer
          session; Approve mirrors the same spinner while phase === "working"
          (edit applying) and flips to the green check once phase resolves so
          the user sees "edit landed" in the compact view before autopilot
          re-expands to hit Worktrees. */}
      <div className="flex items-center gap-1.5 ml-auto">
        {showBell && <PixelBell />}
        {(launched || approveWorking) && <StatusIndicator dot="working" size="sm" />}
        {approveDone && <StatusIndicator dot="done" size="sm" />}
        <span className={["text-[11px] font-medium tracking-tight", labelColor].join(" ")}>
          {labelText}
        </span>
      </div>
    </div>
  );
}

/** Pick the session/worktree the compact notch should represent given the
 *  current tab + phase + resume history. The returned `traitKey` is what
 *  `bnotTraitsFromId` hashes on, and `branch` seeds the secondary color. */
function focalAppearance(
  tab: Tab,
  phases: Phases,
  resumedSessions: Session[],
  focusedTerminalId: string | null,
): { color: BnotColor; traitKey: string; branch: string } {
  // Focused terminal tab wins — covers terminal-tab switches and session-card
  // clicks (both route through setFocusedTerminalId). Matches against the
  // pre-synthesized resumed list first, then the always-running sessions.
  if (focusedTerminalId) {
    const s =
      resumedSessions.find((r) => r.id === focusedTerminalId) ??
      WORKTREE_SESSIONS.find((r) => r.id === focusedTerminalId);
    if (s)
      return { color: s.agentColor, traitKey: s.workingDirectory + s.branch, branch: s.branch };
  }
  // A freshly-resumed worktree wins over the tab default — the user just
  // clicked it, so the bnot should be *that* session's buddy.
  const latestResumed = resumedSessions[0];
  if (latestResumed) {
    return {
      color: latestResumed.agentColor,
      traitKey: latestResumed.workingDirectory + latestResumed.branch,
      branch: latestResumed.branch,
    };
  }
  if (tab.panel.mode === "launch") {
    const s =
      phases.launch.kind === "launched"
        ? tab.panel.newcomer
        : (tab.panel.existing[0] ?? tab.panel.newcomer);
    return { color: s.agentColor, traitKey: s.workingDirectory + s.branch, branch: s.branch };
  }
  if (tab.panel.mode === "approve") {
    const s = tab.panel.hero;
    return { color: s.agentColor, traitKey: s.workingDirectory + s.branch, branch: s.branch };
  }
  // resume
  const worktrees = tab.panel.worktrees;
  let focal = worktrees[tab.panel.cursor] ?? worktrees[0];
  const resumePhase = phases.resume;
  if (resumePhase.kind === "opened") {
    focal = worktrees.find((w) => w.branch === resumePhase.branch) ?? focal;
  }
  return { color: focal.agentColor, traitKey: focal.path + focal.branch, branch: focal.branch };
}

/** Number of distinct running sessions the notch's right-wing label
 *  represents. The base comes from the current tab's panel data — Launch
 *  starts at 1 (billing-webhooks) and grows to 2 when the newcomer spawns;
 *  Approve carries the 2; Resume uses the two always-running WORKTREE_SESSIONS.
 *  Resumed sessions are layered on top, deduped by session id so a click on
 *  an already-running worktree doesn't inflate the count. */
function activeSessionCount(tab: Tab, launched: boolean, resumedSessions: Session[]): number {
  const ids = new Set<string>();
  if (tab.panel.mode === "launch") {
    tab.panel.existing.forEach((s) => ids.add(s.id));
    if (launched) ids.add(tab.panel.newcomer.id);
  } else if (tab.panel.mode === "approve") {
    ids.add(tab.panel.hero.id);
    tab.panel.others.forEach((s) => ids.add(s.id));
  } else {
    WORKTREE_SESSIONS.forEach((s) => ids.add(s.id));
  }
  for (const s of resumedSessions) ids.add(s.id);
  return ids.size;
}
