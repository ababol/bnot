import type { MouseEvent } from "react";
import { useMemo } from "react";
import type { BnotColor } from "../lib/colors";
import { bnotTraitsFromId, sessionStatusDot } from "../lib/colors";
import type { ApprovePhase, Phases, TabId, TerminalLine } from "../lib/demo-state";
import { shortenPath, tokenShort } from "../lib/format";
import type { Approval, PanelView, Session, SessionStatus, Worktree } from "../lib/tabs";
import { branchToSessionId, synthesizeResumedSession, WORKTREE_SESSIONS } from "../lib/tabs";
import { approveDiffLines } from "../lib/terminal-diff";
import styles from "./bnot-panel.module.css";
import { DiffView } from "./diff-view";
import PixelBell from "./pixel-bell";
import PixelBnot from "./pixel-bnot";
import PixelProgressBar from "./pixel-progress-bar";
import StatusIndicator from "./status-indicator";

type PanelHeaderProps = {
  view: PanelView;
  innerTabOverride: "sessions" | null;
  onSwitchTab: (id: TabId) => void;
  onClose: () => void;
};

type PanelBodyProps = {
  view: PanelView;
  tabId: TabId;
  phases: Phases;
  isActive: boolean;
  resumedBranches: string[];
  innerTabOverride: "sessions" | null;
  focusedTerminalId: string | null;
  onPhaseChange: <K extends TabId>(key: K, value: Phases[K]) => void;
  onCompleteAction: () => void;
  onAppendTerminal: (sessionId: string, line: TerminalLine) => void;
  onFocusTerminal: (sessionId: string | null) => void;
  onFocusSessionCard: (sessionId: string) => void;
};

export function PanelHeader({ view, innerTabOverride, onSwitchTab, onClose }: PanelHeaderProps) {
  const bnotColor = panelHeaderBnotColor(view);
  // Override wins on Resume: after the user resumes a worktree the inner pill
  // should read "sessions" so reopening the notch lands on the sessions list
  // instead of the worktree grid. On non-Resume tabs sessions is the default.
  const activeInnerTab: "sessions" | "worktrees" =
    view.mode === "resume"
      ? innerTabOverride === "sessions"
        ? "sessions"
        : "worktrees"
      : "sessions";
  return (
    <div className="flex items-center gap-1.5 px-3 pt-2 pb-2 shrink-0">
      <PixelBnot color={bnotColor} isActive size="lg" />
      <PanelTabs active={activeInnerTab} onSwitchTab={onSwitchTab} />
      <div className="flex-1" />
      <button
        tabIndex={-1}
        className="flex h-[22px] w-[22px] items-center justify-center rounded text-text-dim hover:text-text-muted hover:bg-white/5"
        aria-label="Settings"
        onClick={stopPropagation}
      >
        <GearIcon />
      </button>
      <button
        tabIndex={-1}
        className="flex h-[22px] w-[22px] items-center justify-center rounded text-text-dim hover:text-text-muted hover:bg-white/5 text-[10px] font-bold cursor-pointer"
        aria-label="Close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ✕
      </button>
    </div>
  );
}

export function PanelBody({
  view,
  tabId,
  phases,
  isActive,
  resumedBranches,
  innerTabOverride,
  focusedTerminalId,
  onPhaseChange,
  onCompleteAction,
  onAppendTerminal,
  onFocusTerminal,
  onFocusSessionCard,
}: PanelBodyProps) {
  // Override flips Resume's default WorktreeList to a SessionList — used
  // after a resume-click so the reopened notch shows live sessions (the
  // user already picked a worktree; they now want to interact with the
  // running agents). Base list is WORKTREE_SESSIONS; mergeResumedSessions
  // inside SessionList prepends the resumed synth cards.
  const showSessionsOnResume = view.mode === "resume" && innerTabOverride === "sessions";
  return (
    <div className="flex-1 min-h-0 overflow-hidden px-3 pb-3">
      {view.mode === "launch" && (
        <LaunchList
          existing={view.existing}
          newcomer={view.newcomer}
          tabId={tabId}
          phases={phases}
          isActive={isActive}
          resumedBranches={resumedBranches}
          focusedTerminalId={focusedTerminalId}
          onPhaseChange={onPhaseChange}
          onCompleteAction={onCompleteAction}
          onAppendTerminal={onAppendTerminal}
          onFocusTerminal={onFocusTerminal}
          onFocusSessionCard={onFocusSessionCard}
        />
      )}
      {view.mode === "resume" &&
        (showSessionsOnResume ? (
          <SessionList
            sessions={WORKTREE_SESSIONS}
            heroId={WORKTREE_SESSIONS[0].id}
            tabId={tabId}
            phases={phases}
            isActive={isActive}
            resumedBranches={resumedBranches}
            focusedTerminalId={focusedTerminalId}
            onPhaseChange={onPhaseChange}
            onCompleteAction={onCompleteAction}
            onAppendTerminal={onAppendTerminal}
            onFocusTerminal={onFocusTerminal}
            onFocusSessionCard={onFocusSessionCard}
          />
        ) : (
          <WorktreeList
            worktrees={view.worktrees}
            cursor={view.cursor}
            tabId={tabId}
            phases={phases}
            isActive={isActive}
            resumedBranches={resumedBranches}
            focusedTerminalId={focusedTerminalId}
            onPhaseChange={onPhaseChange}
            onCompleteAction={onCompleteAction}
            onAppendTerminal={onAppendTerminal}
            onFocusTerminal={onFocusTerminal}
            onFocusSessionCard={onFocusSessionCard}
          />
        ))}
      {view.mode === "approve" && (
        <SessionList
          sessions={[view.hero, ...view.others]}
          heroId={view.hero.id}
          tabId={tabId}
          phases={phases}
          isActive={isActive}
          resumedBranches={resumedBranches}
          focusedTerminalId={focusedTerminalId}
          onPhaseChange={onPhaseChange}
          onCompleteAction={onCompleteAction}
          onAppendTerminal={onAppendTerminal}
          onFocusTerminal={onFocusTerminal}
          onFocusSessionCard={onFocusSessionCard}
        />
      )}
    </div>
  );
}

function panelHeaderBnotColor(view: PanelView): BnotColor {
  if (view.mode === "approve") return "orange";
  if (view.mode === "launch") return "green";
  return "blue";
}

const PANEL_TAB_ITEMS: Array<{ key: "sessions" | "worktrees"; tabId: TabId }> = [
  { key: "sessions", tabId: "launch" },
  { key: "worktrees", tabId: "resume" },
];

function PanelTabs({
  active,
  onSwitchTab,
}: {
  active: "sessions" | "worktrees";
  onSwitchTab: (id: TabId) => void;
}) {
  return (
    // Segmented-control layout: fixed track width + flex-1 on each pill so
    // "sessions" and "worktrees" occupy the same box regardless of text
    // length. This also fixes autopilot's click targeting — `useAutoplay`
    // centers on the element's bounding rect, so equal-width pills mean the
    // center lands on the visible label instead of drifting right with the
    // longer "worktrees" string.
    <div className="flex items-center gap-0.5 rounded-md bg-white/5 p-0.5 w-[148px]">
      {PANEL_TAB_ITEMS.map(({ key, tabId }) => (
        <button
          key={key}
          tabIndex={-1}
          // Autopilot drives Approve → Resume by clicking this pill once the
          // edit lands, so the transition reads as a deliberate UI nav.
          data-autoplay={key === "worktrees" ? "approve-next" : undefined}
          className={[
            "flex-1 rounded py-0.5 text-center text-[10px] font-semibold transition-colors capitalize cursor-pointer",
            active === key
              ? "bg-white/10 text-white"
              : "bg-transparent text-text-dim hover:text-white",
          ].join(" ")}
          onClick={(e) => {
            e.stopPropagation();
            onSwitchTab(tabId);
          }}
        >
          {key}
        </button>
      ))}
    </div>
  );
}

function GearIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

type ListProps = {
  tabId: TabId;
  phases: Phases;
  isActive: boolean;
  resumedBranches: string[];
  focusedTerminalId: string | null;
  onPhaseChange: <K extends TabId>(key: K, value: Phases[K]) => void;
  onCompleteAction: () => void;
  onAppendTerminal: (sessionId: string, line: TerminalLine) => void;
  onFocusTerminal: (sessionId: string | null) => void;
  onFocusSessionCard: (sessionId: string) => void;
};

function SessionList({
  sessions,
  heroId,
  ...rest
}: { sessions: Session[]; heroId: string } & ListProps) {
  const {
    resumed,
    remaining,
    heroId: mergedHeroId,
  } = mergeResumedSessions(rest.resumedBranches, sessions, heroId);
  // Focused terminal tab wins over the merge default. If the user has
  // clicked into a specific terminal (or a session card, which focuses it)
  // that's now their "active view" — the panel should highlight the
  // matching card as hero, not whichever session mergeResumedSessions
  // surfaced (latest resumed / scripted default).
  const visibleHeroId = pickHero(rest.focusedTerminalId, resumed, remaining, mergedHeroId);
  return (
    <div className="flex h-full flex-col gap-1.5 overflow-hidden scrollbar-none">
      {resumed.map((s) => (
        <div key={s.id} className="animate-fade-in-up">
          <SessionCard session={s} isHero={s.id === visibleHeroId} {...rest} />
        </div>
      ))}
      {remaining.map((s) => (
        <SessionCard key={s.id} session={s} isHero={s.id === visibleHeroId} {...rest} />
      ))}
    </div>
  );
}

function LaunchList({
  existing,
  newcomer,
  ...rest
}: {
  existing: Session[];
  newcomer: Session;
} & ListProps) {
  const launched = rest.phases.launch.kind === "launched";
  const base = launched ? [newcomer, ...existing] : existing;
  const {
    resumed,
    remaining,
    heroId: mergedHeroId,
  } = mergeResumedSessions(rest.resumedBranches, base, launched ? newcomer.id : existing[0]?.id);
  // Focused terminal tab wins over the scripted default — see SessionList
  // for rationale. Same helper so both lists pick the hero consistently.
  const visibleHeroId = pickHero(rest.focusedTerminalId, resumed, remaining, mergedHeroId);
  return (
    <div className="flex h-full flex-col gap-1.5 overflow-hidden scrollbar-none">
      {resumed.map((s) => (
        <div key={s.id} className="animate-fade-in-up">
          <SessionCard session={s} isHero={s.id === visibleHeroId} {...rest} />
        </div>
      ))}
      {remaining.map((s) =>
        launched && s.id === newcomer.id ? (
          <div key={s.id} className="animate-fade-in-up">
            <SessionCard session={s} isHero={s.id === visibleHeroId} {...rest} />
          </div>
        ) : (
          <SessionCard key={s.id} session={s} isHero={s.id === visibleHeroId} {...rest} />
        ),
      )}
    </div>
  );
}

/** Hero-card selector shared by SessionList and LaunchList. If the user is
 *  focused on a specific terminal tab and that session is visible in the
 *  list, use it as hero. A session in `waitingApproval` otherwise wins over
 *  the resumed default — the user's attention is being requested there, so
 *  the matching card must be hero (its approval inline + diff) rather than
 *  some freshly-resumed background worktree that happens to sort first. */
function pickHero(
  focusedTerminalId: string | null,
  resumed: Session[],
  remaining: Session[],
  fallback: string | undefined,
): string | undefined {
  if (focusedTerminalId) {
    if (resumed.some((s) => s.id === focusedTerminalId)) return focusedTerminalId;
    if (remaining.some((s) => s.id === focusedTerminalId)) return focusedTerminalId;
  }
  for (const s of resumed) if (s.status === "waitingApproval") return s.id;
  for (const s of remaining) if (s.status === "waitingApproval") return s.id;
  return fallback;
}

/** Merge resumed-branch sessions (newest first) with a base list, deduping
 *  by id — the synth resumed entry wins on collision so the "just resumed →
 *  running" card state is preserved. Returns the two groups separately so
 *  callers can wrap the resumed group in their own entrance animation. */
function mergeResumedSessions(
  branches: string[],
  base: Session[],
  defaultHeroId: string | undefined,
): { resumed: Session[]; remaining: Session[]; heroId: string | undefined } {
  const resumed: Session[] = [];
  const seen = new Set<string>();
  for (const b of branches) {
    const s = synthesizeResumedSession(b);
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    resumed.push(s);
  }
  const remaining = base.filter((s) => !seen.has(s.id));
  return { resumed, remaining, heroId: resumed[0]?.id ?? defaultHeroId };
}

function WorktreeList({
  worktrees,
  cursor,
  tabId,
  phases,
  isActive,
  onPhaseChange,
  onCompleteAction,
  onAppendTerminal,
  onFocusSessionCard,
}: { worktrees: Worktree[]; cursor: number } & ListProps) {
  const phase = phases.resume;
  return (
    <div className="flex h-full flex-col gap-1.5 overflow-hidden scrollbar-none">
      {worktrees.map((w, i) => (
        <WorktreeCard
          key={w.path}
          worktree={w}
          isCursor={i === cursor}
          opened={phase.kind === "opened" && phase.branch === w.branch}
          onClick={() => {
            if (!isActive || tabId !== "resume") return;
            const sessionKey = branchToSessionId(w.branch);
            const isAlreadyOpened = phase.kind === "opened" && phase.branch === w.branch;
            // Re-clicking an already-opened worktree skips the phase-change
            // + terminal-line echo (no duplicate "Spawned new tab" lines).
            // Either way, focus the terminal + compact the notch: `onFocus
            // SessionCard` bundles both so the compact happens even when
            // phases.resume doesn't change (the resume-compact effect is
            // only fired by a new phase value).
            if (!isAlreadyOpened) {
              onPhaseChange("resume", { kind: "opened", branch: w.branch });
              const now = Date.now();
              if (w.isActive) {
                onAppendTerminal(sessionKey, {
                  id: `${sessionKey}-jump-${now}`,
                  kind: "success",
                  text: `✓ Jumped to Ghostty tab — ${w.branch}`,
                });
              } else {
                onAppendTerminal(sessionKey, {
                  id: `${sessionKey}-resume-${now}`,
                  kind: "success",
                  text: `✓ Spawned new tab, claude --resume ${w.branch}`,
                });
                onAppendTerminal(sessionKey, {
                  id: `${sessionKey}-resume-tool-${now + 1}`,
                  kind: "tool",
                  text: `▸ Resuming session (${w.lastActivity})`,
                });
              }
            }
            onFocusSessionCard(sessionKey);
            // Resume is the demo's terminal step (loop=false in the cycle),
            // so the pulse here doesn't advance to another tab — it just
            // races the progress bar to 100% so the indicator completes in
            // lockstep with the worktree click.
            onCompleteAction();
          }}
        />
      ))}
    </div>
  );
}

type SessionCardProps = { session: Session; isHero: boolean } & ListProps;

function SessionCard({
  session,
  isHero,
  tabId,
  phases,
  isActive,
  onPhaseChange,
  onAppendTerminal,
  onFocusTerminal,
  onFocusSessionCard,
}: SessionCardProps) {
  const traits = useMemo(
    () => bnotTraitsFromId(session.workingDirectory + session.branch, session.branch),
    [session.workingDirectory, session.branch],
  );
  // While the approve flow is mid-action, the session looks like any other
  // active-working session: no alert bell, no waiting dot. The orange
  // "needs attention" cue is precisely what should fade the moment the user
  // hits Yes — and once the edit lands, the top dot flips to a check so the
  // success state reads at a glance, not just inside the approval row.
  // Scoped to `session.approval` so the phase only affects the session
  // that actually holds the approval — otherwise the Stripe-webhook card
  // (no approval, status=idle) would get dragged into Working state
  // alongside the checkout-redirect card when the user hits Yes. Not gated
  // on `isActive` so the Approve layer keeps rendering the resolved row
  // (Working…/Edit applied) while it fades out during the Approve → Resume
  // autopilot transition — otherwise the idle Yes/No buttons flash back in
  // for the duration of the layer cross-fade.
  const approvePhase: ApprovePhase =
    tabId === "approve" && session.approval ? phases.approve : { kind: "idle" };
  const approveResolved = approvePhase.kind !== "idle";
  const isApproveDone = approvePhase.kind === "approved" || approvePhase.kind === "always";
  const isApproveWorking = approvePhase.kind === "working";
  const effectiveStatus: SessionStatus = isApproveDone
    ? "completed"
    : approveResolved
      ? "active"
      : session.status;
  const showAsWorking =
    isApproveWorking || (session.status === "active" && !!session.currentTool && !approveResolved);
  const dot = sessionStatusDot(effectiveStatus, showAsWorking, session.sessionMode);
  const cardBg = isHero ? "bg-surface-hover" : "bg-surface";
  const ring = isHero ? "ring-1 ring-white/10" : "";
  const needsAttention =
    !approveResolved &&
    (session.status === "waitingApproval" || session.status === "waitingAnswer");

  // Cards with an open approval prompt must not collapse the notch on
  // click — the user is being asked to decide, not to switch views. Every
  // other state: clicking the card focuses its terminal tab and compacts
  // the notch so the terminal becomes the stage (matches WorktreeCard).
  const handleCardClick = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    if (!isActive) return;
    if (session.approval && !approveResolved) return;
    onFocusSessionCard(session.id);
  };
  return (
    <div
      className={[
        styles.card,
        cardBg,
        ring,
        isActive && !(session.approval && !approveResolved) ? "cursor-pointer" : "",
      ].join(" ")}
      onClick={handleCardClick}
      role={isActive ? "button" : undefined}
    >
      <div className="flex items-center gap-1.5">
        <PixelBnot color={session.agentColor} isActive={showAsWorking} traits={traits} size="sm" />
        <StatusIndicator dot={dot} size="sm" />
        <div className="min-w-0 flex-1 truncate text-xs font-medium text-white">{session.name}</div>
        {session.sessionMode === "plan" && <ModeBadge label="PLAN" tone="cyan" pulse />}
        {session.sessionMode === "auto" && <ModeBadge label="AUTO" tone="cyan" />}
        {session.sessionMode === "dangerous" && <ModeBadge label="YOLO" tone="red" />}
        <div className="shrink-0 font-mono text-[10px] text-text-dim">{session.elapsed}</div>
        {needsAttention && <PixelBell />}
      </div>

      {session.approval && (
        <ApprovalInline
          approval={session.approval}
          phase={approvePhase}
          onDecision={(decision) => {
            if (!isActive || tabId !== "approve") return;
            onFocusTerminal(session.id);
            const approval = session.approval!;
            // Stage 1 (immediate): bell vanishes, card flips to the normal
            // active-working layout, approval-ack line + tool line hit the
            // terminal. Spinner runs inline.
            onPhaseChange("approve", { kind: "working", decision });
            const ackText = approveTerminalText({ kind: decision }, approval);
            if (ackText) {
              // Ids intentionally match the Resume tab's pre-baked concluded
              // transcript (see checkoutApproveConcluded in terminals.tsx) so
              // the ack/tool/applied DOM nodes stay mounted across the
              // Approve → Resume autopilot transition. The render-side dedup
              // keeps pre-baked on Resume (first occurrence wins), which
              // means no visual re-mount and no duplicate lines.
              onAppendTerminal(session.id, {
                id: `${session.id}-a-ack`,
                kind: decision === "denied" ? "error" : "success",
                text: ackText,
              });
              if (decision !== "denied") {
                onAppendTerminal(session.id, {
                  id: `${session.id}-a-tool`,
                  kind: "tool",
                  text: approveFollowupText(approval),
                });
                // Inline diff preview — stat + hunk rows. Ids match the
                // pre-baked Resume transcript (approveDiffLines keys on
                // session.id + `-a-diff-*`) so React keeps the DOM mounted
                // across Approve → Resume and the render-time dedup drops
                // duplicates. Skipped on "denied" because nothing applies.
                for (const line of approveDiffLines(session.id, approval)) {
                  onAppendTerminal(session.id, line);
                }
              }
            }
            // Stage 2 (~1.5s): Claude "finished" — flip to the final phase
            // so the inline working row swaps its spinner for a check, and
            // append the ✓ Edit-applied line to the terminal. The autopilot
            // takes over from here: useAutoplay sees approve.kind === decision
            // and moves the cursor to the "worktrees" pill in the panel
            // header, clicking it to navigate to Resume — so the transition
            // reads as a deliberate UI nav rather than a hard cycle tick
            // (which produced a visible glitch when pulsePause swapped tabs
            // out from under the cursor).
            window.setTimeout(() => {
              onPhaseChange("approve", { kind: decision });
              if (decision !== "denied" && approval.diff) {
                onAppendTerminal(session.id, {
                  id: `${session.id}-a-done`,
                  kind: "success",
                  text: `✓ ${approval.tool} applied — +${approval.diff.added} −${approval.diff.removed}`,
                });
              }
            }, 1500);
          }}
        />
      )}
      {isHero && (!session.approval || approveResolved) && (
        // Context bar visible whenever the card is the hero and no action
        // is pending the user's decision. That means: always for sessions
        // without an approval, and for sessions *after* the approval has
        // been resolved (working/approved/denied) — the ApprovalWorkingRow
        // above this block stacks together with the context bar so the
        // user can still see the session's token usage while the edit runs.
        <div className="mt-1.5 flex flex-col gap-1">
          {session.currentTool && !session.approval && (
            <div className="flex gap-1.5 font-mono text-[11px] text-bnot-cyan">
              <span className="font-medium">{session.currentTool}</span>
              {session.currentFilePath && (
                <span className="truncate text-text-dim">
                  {shortenPath(session.currentFilePath)}
                </span>
              )}
            </div>
          )}
          <div className="truncate text-left font-mono text-[10px] text-text-dim" dir="rtl">
            {session.workingDirectory}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex-1">
              <PixelProgressBar
                percent={session.contextTokens / session.maxContextTokens}
                color={contextBarColor(effectiveStatus)}
              />
            </div>
            <div className="shrink-0 font-mono text-[9px] font-medium text-text-dim">
              {tokenShort(session.contextTokens)}/{tokenShort(session.maxContextTokens)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function approveTerminalText(phase: ApprovePhase, approval: Approval | undefined): string | null {
  if (phase.kind === "approved") return `✓ Approved ${approval?.tool ?? "tool"} by user`;
  if (phase.kind === "always")
    return `✓ Allowed ${approval?.tool ?? "tool"} always for this session`;
  if (phase.kind === "denied") return `✗ Denied ${approval?.tool ?? "tool"} by user`;
  return null;
}

function approveFollowupText(approval: Approval): string {
  // `●` matches real Claude Code's tool-call marker (same glyph used in
  // the reference screenshots) and aligns with the diff stat-line bullet
  // that follows — reads as one logical ● Edit(path) → ⎿ stat → diff row.
  if (approval.input) return `● Bash(${approval.input})`;
  if (approval.filePath) return `● ${approval.tool}(${shortenPath(approval.filePath)})`;
  return `● ${approval.tool}`;
}

type ApprovalInlineProps = {
  approval: Approval;
  phase: ApprovePhase;
  onDecision: (decision: "approved" | "always" | "denied") => void;
};

function ApprovalInline({ approval, phase, onDecision }: ApprovalInlineProps) {
  // Once the user hits Yes/No/Always the diff + buttons collapse away and
  // the card shows an inline "working" row instead — the session goes back
  // to looking like any other active session running a tool. No big centered
  // overlay: it's jarring and buries the rest of the card.
  if (phase.kind !== "idle") {
    return <ApprovalWorkingRow approval={approval} phase={phase} />;
  }
  return (
    <div className="relative mt-1.5">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[11px]">{"\u26A0"}</span>
        <span className="font-mono text-[12px] font-bold text-bnot-orange">{approval.tool}</span>
        {approval.diff && (
          <span className="ml-auto font-mono text-[10px] text-text-dim">
            <span className="text-bnot-green">+{approval.diff.added}</span>{" "}
            <span className="text-bnot-red">-{approval.diff.removed}</span>
          </span>
        )}
      </div>
      {approval.filePath && !approval.input && (
        <div className="mt-1.5 overflow-hidden rounded-lg bg-surface">
          <div className="px-2 py-1 font-mono text-[10.5px] text-bnot-cyan">
            {shortenPath(approval.filePath)}
          </div>
          {approval.diffText && (
            <div className="max-h-[128px] overflow-hidden border-t border-white/5">
              <DiffView diff={approval.diffText} />
            </div>
          )}
        </div>
      )}
      {approval.input && (
        <div className="mt-1.5 max-h-[100px] overflow-hidden rounded-lg bg-surface">
          {approval.filePath && (
            <div className="border-b border-white/5 px-2 py-1 font-mono text-[10px] text-text-dim">
              {shortenPath(approval.filePath)}
            </div>
          )}
          <div className="px-2.5 py-2 font-mono text-[11px] text-bnot-green">
            <span className="mr-1.5 text-text-dim">$</span>
            {approval.input}
          </div>
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <button
          data-autoplay="approve-primary"
          className={`${styles.approvalBtnPrimary} text-[12px]`}
          onClick={(e) => {
            e.stopPropagation();
            onDecision("approved");
          }}
        >
          Yes
        </button>
        <button
          className={`${styles.approvalBtnSecondary} text-[11px]`}
          onClick={(e) => {
            e.stopPropagation();
            onDecision("always");
          }}
        >
          Don't ask again
        </button>
        <button
          className={`${styles.approvalBtnSecondary} text-[12px]`}
          onClick={(e) => {
            e.stopPropagation();
            onDecision("denied");
          }}
        >
          No
        </button>
      </div>
    </div>
  );
}

function ApprovalWorkingRow({ approval, phase }: { approval: Approval; phase: ApprovePhase }) {
  const target = approval.filePath ? shortenPath(approval.filePath) : approval.tool;
  const working = phase.kind === "working";
  const denied = phase.kind === "denied";
  const done = phase.kind === "approved" || phase.kind === "always";
  // The tiny state machine this component visualises:
  //   working → pixel-spinner + "Working…" in cyan
  //   done    → pixel-check + file path + light green "Edit applied"
  //   denied  → red ✗ + "Denied"
  const toneClass = denied ? "text-bnot-red" : done ? "text-bnot-green" : "text-bnot-cyan";
  const rightLabel = working ? "Working…" : denied ? "Denied" : "Edit applied";
  return (
    <div className="mt-1.5 animate-fade-in-overlay flex flex-col gap-1">
      <div className="flex items-center gap-1.5 font-mono text-[11px]">
        {denied ? (
          <span className="text-bnot-red" aria-hidden="true">
            ✗
          </span>
        ) : done ? (
          <StatusIndicator dot="done" size="sm" />
        ) : (
          <StatusIndicator dot="working" size="sm" />
        )}
        <span className={`font-medium ${toneClass}`}>{approval.tool}</span>
        <span className="truncate text-text-dim">{target}</span>
        <span className={`ml-auto text-[10px] ${done ? "text-bnot-green" : "text-text-dim"}`}>
          {rightLabel}
        </span>
      </div>
    </div>
  );
}

type WorktreeCardProps = {
  worktree: Worktree;
  isCursor: boolean;
  opened: boolean;
  onClick: () => void;
};

function WorktreeCard({ worktree, isCursor, opened, onClick }: WorktreeCardProps) {
  const resumedCopy = worktree.isActive ? "Jumped to Ghostty" : "Resumed session";
  // Autopilot targets the first idle worktree so the narrative payoff is
  // "spawning a new Ghostty tab" rather than "jumping back to the active one".
  const isAutoplayTarget = worktree.branch === "chore/docs-readme";
  return (
    <div
      data-autoplay={isAutoplayTarget ? "resume-primary" : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={[
        styles.card,
        "cursor-pointer",
        isCursor ? "bg-surface-active ring-1 ring-white/20" : "bg-surface hover:bg-surface-hover",
      ].join(" ")}
      role="button"
    >
      <div className="flex items-center gap-1.5">
        <span
          className={[
            "h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
            // `opened` is scoped to the current `phase.branch`, so this only
            // lights up the worktree the user just clicked — previously
            // opened cards don't stay green. The fiction is "you just
            // resumed this session, so it's now running"; the dot mirrors
            // that state alongside the cyan "Resumed session" badge.
            worktree.isActive || opened ? "bg-bnot-green" : "bg-white/25",
          ].join(" ")}
        />
        <div className="min-w-0 flex-1 truncate text-xs font-medium text-white">
          {worktree.branch}
        </div>
        {opened ? (
          <span className="shrink-0 inline-flex items-center gap-1 rounded bg-bnot-cyan/20 px-1 py-px text-[9px] font-bold text-bnot-cyan animate-fade-in-overlay">
            <CheckIcon /> {resumedCopy}
          </span>
        ) : worktree.isActive ? (
          <span className="shrink-0 rounded bg-bnot-green/20 px-1 py-px text-[9px] font-bold text-bnot-green">
            ACTIVE
          </span>
        ) : null}
        <div className="shrink-0 font-mono text-[10px] text-text-dim">{worktree.lastActivity}</div>
      </div>
      <div className="mt-0.5 flex gap-2 text-[10px] text-text-dim">
        <span className="truncate">{worktree.repoName}</span>
        <span className="ml-auto truncate text-left font-mono text-text-dim" dir="rtl">
          {shortenPath(worktree.path)}
        </span>
      </div>
    </div>
  );
}

function ModeBadge({
  label,
  tone,
  pulse,
}: {
  label: string;
  tone: "cyan" | "red";
  pulse?: boolean;
}) {
  return (
    <span
      className={[
        tone === "cyan" ? styles.modeBadgeCyan : styles.modeBadgeRed,
        pulse ? "animate-pulse-dot" : "",
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function stopPropagation(e: MouseEvent<HTMLElement>) {
  e.stopPropagation();
}

function contextBarColor(status: SessionStatus): BnotColor {
  if (status === "waitingApproval") return "orange";
  if (status === "waitingAnswer") return "cyan";
  if (status === "completed") return "green";
  return "blue";
}
