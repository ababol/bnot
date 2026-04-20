import { useMemo } from "react";
import { bnotTraitsFromId, MAIN_COLORS } from "../lib/colors";
import type { Phases, TabId, TerminalActions, TerminalLine } from "../lib/demo-state";
import { shortenPath } from "../lib/format";
import type { Session, Tab, Worktree } from "../lib/tabs";
import { branchToSessionId, CHECKOUT_APPROVAL, WORKTREE_SESSIONS } from "../lib/tabs";
import { approveDiffLines } from "../lib/terminal-diff";
import PixelBnot from "./pixel-bnot";
import styles from "./terminals.module.css";

type TerminalsProps = {
  tab: Tab;
  phases: Phases;
  focusedId: string | null;
  actions: TerminalActions;
  onSelectTerminalTab: (sessionId: string) => void;
};

// Stable reference for the "no actions yet" fallback so the `lines` useMemo
// below doesn't see a fresh `[]` every render and invalidate its cache.
const EMPTY_ACTIONS: TerminalLine[] = [];

/** Terminal tabs to surface for a given outer demo tab.
 *  Launch mode hides the newcomer tab until the user clicks "Open in worktree".
 *  Resume mode appends a fresh tab when the user clicks an idle worktree —
 *  matches the real bnot behavior of spawning a new Ghostty tab via
 *  `claude --resume`. */
function tabSessions(tab: Tab, phases: Phases): Session[] {
  const p = tab.panel;
  if (p.mode === "launch") {
    const launched = phases.launch.kind === "launched";
    return launched ? [...p.existing, p.newcomer] : [...p.existing];
  }
  if (p.mode === "approve") return [p.hero, ...p.others];
  // resume
  const resume = phases.resume;
  if (resume.kind === "opened") {
    const wt = p.worktrees.find((w) => w.branch === resume.branch);
    if (wt && !wt.isActive) {
      const resumed = sessionFromWorktree(wt);
      if (!WORKTREE_SESSIONS.some((s) => s.id === resumed.id)) {
        return [...WORKTREE_SESSIONS, resumed];
      }
    }
  }
  return WORKTREE_SESSIONS;
}

/** Build a session from an idle worktree the user just resumed.
 *  Mirrors the shape `WORKTREE_SESSIONS` uses so the rest of the terminal
 *  rendering treats it identically. */
function sessionFromWorktree(w: Worktree): Session {
  return {
    id: branchToSessionId(w.branch),
    name: worktreeName(w.branch),
    branch: w.branch,
    repoName: w.repoName,
    workingDirectory: w.path,
    agentColor: w.agentColor,
    status: "active",
    contextTokens: 0,
    maxContextTokens: 200_000,
    elapsed: "0m 02s",
  };
}

function worktreeName(branch: string): string {
  if (branch === "chore/docs-readme") return "Update README and contribution guide";
  if (branch === "refactor/auth-session") return "Refactor auth session helpers";
  return branch;
}

/** The "naturally active" tab for a given demo tab — what gets highlighted
 *  when the user hasn't manually focused anything yet. */
function heroForTab(tab: Tab, phases: Phases, list: Session[]): string | undefined {
  const p = tab.panel;
  if (p.mode === "launch") {
    const launched = phases.launch.kind === "launched";
    return launched ? p.newcomer.id : p.existing[0]?.id;
  }
  if (p.mode === "approve") return p.hero.id;
  return list[0]?.id;
}

function claudeBootBanner(session: Session): TerminalLine[] {
  const dir = shortenPath(session.workingDirectory);
  const color = session.agentColor;
  const branchTip = session.branch.split("/").pop() ?? session.branch;
  const base = `${session.id}-boot`;
  // bootSprite carries four \n-separated lines rendered beside a PixelBnot
  // at xl size. The real Claude Code banner has a pixel-art sprite in this
  // slot; using the per-session PixelBnot keeps the identity consistent
  // with the notch + session cards and avoids the solid-rectangle glyphs
  // the Unicode block characters previously produced.
  const sprite = [
    "Claude Code v2.1.114",
    "Opus 4.7 (1M context) with high effort · Claude Max",
    dir,
    "Welcome to Opus 4.7 xhigh! · /effort to tune speed vs. intelligence",
  ].join("\n");
  return [
    { id: `${base}-dir`, kind: "dim", text: `${dir} ${branchTip}*  0s` },
    {
      id: `${base}-cmd`,
      kind: "prompt",
      text: `❯ claude "Issue #482: Checkout redirect loop issue"`,
    },
    { id: `${base}-sprite`, kind: "bootSprite", color, text: sprite },
    { id: `${base}-gap-1`, kind: "output", text: "\u00A0" },
    { id: `${base}-color-cmd`, kind: "prompt", text: `❯ /color ${color}` },
    {
      id: `${base}-color-ack`,
      kind: "banner",
      color,
      text: `  \u2514 Session color set to: ${color}`,
    },
    { id: `${base}-gap-2`, kind: "output", text: "\u00A0" },
    {
      id: `${base}-divider`,
      kind: "banner",
      color,
      text: "\u2500".repeat(120),
    },
    { id: `${base}-ready`, kind: "prompt", text: "❯ " },
  ];
}

/** Cumulative, tab-aware transcript for the checkout-redirect session.
 *  Each tab adds the next narrative beat on top of the previous one — so the
 *  last frame of tab N is the first frame of tab N+1, plus the new lines
 *  that tab mounts (which fade in). The story:
 *  – Launch: Claude boots on the fresh worktree.
 *  – Approve: user follows up → Claude explores → reproduces → requests Edit.
 *  – Resume: Edit applied, tests running; user switches worktree in the notch. */
function checkoutRedirectTranscript(
  session: Session,
  tabId: TabId,
  phases: Phases,
): TerminalLine[] {
  if (tabId === "launch" && phases.launch.kind === "idle") return [];

  const lines: TerminalLine[] = [...claudeBootBanner(session)];

  if (tabId === "launch") {
    // Stable `-user-msg` id shared with Approve/Resume: React keeps the DOM
    // node mounted across tab changes and just flips `kind` from "typing" to
    // "prompt", so the locked-in typewriter state doesn't re-animate.
    lines.pop();
    lines.push({
      id: `${session.id}-user-msg`,
      kind: "typing",
      text: "❯ fix the checkout redirect loop",
    });
    lines.push({
      id: `${session.id}-processing`,
      kind: "processing",
      text: "Processing…",
    });
    const exp = checkoutExploration(session);
    exp.forEach((line, i) => lines.push({ ...line, revealDelayMs: 2500 + i * 450 }));
    return lines;
  }

  // Approve & Resume: the `-user-msg` id + exploration ids match Launch's,
  // so React keeps those DOM nodes mounted across the tab change — their
  // fade-in animation is already locked via `both` fill mode, and we re-emit
  // without `revealDelayMs` so the settled state persists.
  lines.pop();
  lines.push({
    id: `${session.id}-user-msg`,
    kind: "prompt",
    text: "❯ fix the checkout redirect loop",
  });
  lines.push(...checkoutExploration(session));

  if (tabId === "approve") {
    // First frame of Approve: the question is already on screen, paired with
    // the diff in the notch. The post-decision ack / tool / applied lines are
    // appended by the click handler (SessionCard.onDecision in bnot-panel.tsx).
    lines.push({
      id: `${session.id}-a`,
      kind: "output",
      text: "? Approve Edit: …/middleware/auth.ts",
    });
    return lines;
  }

  // Resume: approval concluded; Claude finished the edit and is running tests.
  lines.push(...checkoutApproveConcluded(session));
  return lines;
}

function checkoutExploration(session: Session): TerminalLine[] {
  return [
    {
      id: `${session.id}-exp-start`,
      kind: "dim",
      text: "● Reading issue #482 and reproduction steps…",
    },
    { id: `${session.id}-exp-t1`, kind: "tool", text: "▸ Read(app/checkout/page.tsx)" },
    { id: `${session.id}-exp-t2`, kind: "tool", text: "▸ Read(middleware/auth.ts)" },
  ];
}

function checkoutApproveConcluded(session: Session): TerminalLine[] {
  // Ids deliberately match the ones the Approve-tab click handler uses for
  // its appended terminal lines (SessionCard.onDecision in bnot-panel.tsx).
  // When the tab advances Approve → Resume, React keys line up, so the DOM
  // nodes stay mounted across the transition — no fade-out/fade-in flicker,
  // and the render-time dedup below removes the duplicate entries from the
  // concatenated [transcript, ...actions] list.
  return [
    { id: `${session.id}-a`, kind: "output", text: "? Approve Edit: …/middleware/auth.ts" },
    { id: `${session.id}-a-ack`, kind: "success", text: "✓ Approved Edit by user" },
    {
      id: `${session.id}-a-tool`,
      kind: "tool",
      text: `● Edit(${shortenPath(session.workingDirectory)}/middleware/auth.ts)`,
    },
    ...approveDiffLines(session.id, CHECKOUT_APPROVAL),
    { id: `${session.id}-a-done`, kind: "success", text: "✓ Edit applied — +8 −2" },
  ];
}

function billingWebhooksTranscript(session: Session): TerminalLine[] {
  const dir = shortenPath(session.workingDirectory);
  const branchTip = session.branch.split("/").pop() ?? session.branch;
  const sid = session.id;
  return [
    { id: `${sid}-dir`, kind: "dim", text: `${dir} ${branchTip}*  14m 02s` },
    {
      id: `${sid}-cmd`,
      kind: "prompt",
      text: `❯ claude "Wire Stripe webhook handler"`,
    },
    { id: `${sid}-tool`, kind: "tool", text: "▸ Bash(pytest billing/ -v)" },
    {
      id: `${sid}-p1`,
      kind: "output",
      text: "billing/test_webhooks.py::test_stripe_signature PASSED [ 33%]",
    },
    {
      id: `${sid}-p2`,
      kind: "output",
      text: "billing/test_webhooks.py::test_invoice_created PASSED [ 66%]",
    },
    {
      id: `${sid}-p3`,
      kind: "output",
      text: "billing/test_webhooks.py::test_subscription_update PASSED [100%]",
    },
    { id: `${sid}-idle`, kind: "dim", text: "● idle — last activity 14m 02s" },
  ];
}

function fallbackTranscript(session: Session): TerminalLine[] {
  const prompt: TerminalLine = {
    id: `${session.id}-prompt`,
    kind: "prompt",
    text: `> claude --resume ${session.branch}`,
  };
  const lines: TerminalLine[] = [prompt];
  if (session.currentTool) {
    lines.push({
      id: `${session.id}-tool`,
      kind: "tool",
      text: `▸ ${session.currentTool}${session.currentFilePath ? `(${shortenPath(session.currentFilePath)})` : ""}`,
    });
  }
  if (session.status === "idle") {
    lines.push({
      id: `${session.id}-idle`,
      kind: "dim",
      text: `● idle — last activity ${session.elapsed}`,
    });
  } else if (session.currentTool) {
    lines.push({ id: `${session.id}-running`, kind: "dim", text: "● running…" });
  } else {
    lines.push({ id: `${session.id}-waiting`, kind: "dim", text: "● waiting…" });
  }
  return lines;
}

function sessionTranscript(session: Session, tabId: TabId, phases: Phases): TerminalLine[] {
  if (session.id === "checkout-redirect") {
    return checkoutRedirectTranscript(session, tabId, phases);
  }
  if (session.id === "billing-webhooks") {
    return billingWebhooksTranscript(session);
  }
  if (session.id === "chore-docs-readme" || session.id === "refactor-auth-session") {
    return resumedSessionTranscript(session);
  }
  return fallbackTranscript(session);
}

/** Minimal transcript for a freshly-resumed worktree — just the dir line and
 *  the resume prompt. The click handler in `WorktreeList` appends the
 *  `✓ Spawned new tab` + `▸ Resuming session` lines that complete the picture. */
function resumedSessionTranscript(session: Session): TerminalLine[] {
  const dir = shortenPath(session.workingDirectory);
  const branchTip = session.branch.split("/").pop() ?? session.branch;
  return [
    { id: `${session.id}-dir`, kind: "dim", text: `${dir} ${branchTip}*  0s` },
    { id: `${session.id}-cmd`, kind: "prompt", text: `❯ claude --resume` },
  ];
}

export function Terminals({
  tab,
  phases,
  focusedId,
  actions,
  onSelectTerminalTab,
}: TerminalsProps) {
  // Narrow deps to the phase slices these helpers actually read — `setPhase`
  // spreads a new top-level `phases` on every mutation, so depending on the
  // whole object would rebuild the transcript on unrelated phase changes.
  const sessions = useMemo(
    () => tabSessions(tab, phases),
    [tab, phases.launch.kind, phases.resume],
  );
  const fallbackHero = useMemo(
    () => heroForTab(tab, phases, sessions),
    [tab, phases.launch.kind, sessions],
  );
  const activeId =
    (focusedId && sessions.some((s) => s.id === focusedId) ? focusedId : fallbackHero) ??
    sessions[0]?.id;

  // Only the Launch tab's pre-click state keeps the terminal small (so the
  // GitHub browser can be the hero). Once the worktree is opened, and on
  // every subsequent tab, the terminal stays at full size and the notch
  // panel floats above it — matching the real bnot app, where opening the
  // notch never shrinks your terminal.
  const elevated = tab.id !== "launch" || phases.launch.kind === "launched";

  if (sessions.length === 0) return null;

  const activeSession = sessions.find((s) => s.id === activeId) ?? sessions[0];
  const activeActions = actions[activeSession.id] ?? EMPTY_ACTIONS;
  // Dedup by id — pre-baked and appended may share ids on purpose (e.g. the
  // approve ack/tool/applied lines carry the same `-a-*` ids on both sides
  // so React can keep DOM mounted across the Approve → Resume transition).
  // Keeping first-occurrence means the pre-baked line wins on Resume, and
  // the appended line wins on Approve (before the transcript carries them).
  const lines = useMemo(() => {
    const seen = new Set<string>();
    return [...sessionTranscript(activeSession, tab.id, phases), ...activeActions].filter((l) => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });
  }, [activeSession, tab.id, phases.launch.kind, activeActions]);

  return (
    <div className={[styles.wrap, elevated ? styles.wrapElevated : ""].join(" ")}>
      <div className={[styles.terminal, elevated ? styles.terminalElevated : ""].join(" ")}>
        <div className={styles.chrome}>
          <div className="flex h-[22px] items-center gap-2 px-3">
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="h-[10px] w-[10px] rounded-full bg-[#ff5f57]" />
              <span className="h-[10px] w-[10px] rounded-full bg-[#febc2e]" />
              <span className="h-[10px] w-[10px] rounded-full bg-[#28c840]" />
            </span>
            <div className="flex items-end gap-0.5 ml-2 overflow-hidden">
              {sessions.map((s) => {
                const isActive = s.id === activeSession.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectTerminalTab(s.id);
                    }}
                    className={[styles.tab, isActive ? styles.tabActive : ""].join(" ")}
                    title={`claude — ${s.branch}`}
                  >
                    <span
                      className={styles.tabDot}
                      style={{ background: MAIN_COLORS[s.agentColor] }}
                    />
                    <span className={styles.tabLabel}>claude — {s.branch}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className={[styles.body, elevated ? styles.bodyElevated : ""].join(" ")}>
          {lines.map((line) => (
            <TerminalRow key={`${activeSession.id}:${line.id}`} line={line} />
          ))}
          <div className={styles.caret} aria-hidden="true">
            ▋
          </div>
        </div>
      </div>
    </div>
  );
}

/** Every new line fades in on first mount (React keys keep old lines stable
 *  across tab changes, so the already-mounted lines don't re-animate).
 *  "typing" and "processing" are special-cased: they carry their own entrance
 *  animation with a delay baked in so the Launch narrative reads
 *  type-then-think before advancing. */
function termLineClass(kind: TerminalLine["kind"]): string {
  const base = "animate-fade-in-overlay";
  switch (kind) {
    case "prompt":
      return `text-white/85 ${base}`;
    case "typing":
      return "text-white/85 animate-[terminal-typing_1.2s_steps(28,end)_0.5s_both]";
    case "processing":
      return "text-bnot-orange";
    case "tool":
      return `text-bnot-cyan ${base}`;
    case "success":
      return `text-bnot-green ${base}`;
    case "error":
      return `text-bnot-red ${base}`;
    case "dim":
      return `text-white/40 ${base}`;
    case "banner":
      return base;
    case "bootSprite":
      return base;
    case "diff":
      return base;
    case "output":
      return `text-white/80 ${base}`;
  }
}

function TerminalRow({ line }: { line: TerminalLine }) {
  const className = termLineClass(line.kind);
  const style: React.CSSProperties = {};
  if (line.color) style.color = MAIN_COLORS[line.color];
  if (line.kind === "processing") {
    // Both keyframes animate opacity AND max-height so the pre-reveal slot
    // takes 0 height — otherwise the invisible row reserves a line of blank
    // space between "❯ fix the…" and the caret.
    style.animation =
      "processingFadeIn 0.15s ease-out 1.7s both, processingFadeOut 0.4s ease-in 2.5s forwards";
    style.overflow = "hidden";
  } else if (line.revealDelayMs != null) {
    // Staggered reveal — uses `terminalLineReveal` instead of the plain
    // `fadeInOverlay` so each pre-reveal line collapses to zero height.
    // Otherwise invisible placeholders stack between the last visible row
    // and the caret, leaving a big gap inside the terminal body.
    style.animation = `terminalLineReveal 0.4s ease-out ${line.revealDelayMs}ms both`;
  }
  if (line.kind === "processing") {
    return (
      <div className={className} style={style}>
        <span className="inline-block origin-center animate-[terminal-processing-pulse_1.4s_ease-in-out_infinite]">
          {"\u2731"}
        </span>{" "}
        {line.text}
      </div>
    );
  }
  if (line.kind === "diff" && line.diffMeta) {
    const { marker, num } = line.diffMeta;
    const rowBg =
      marker === "+" ? "bg-bnot-green/[0.08]" : marker === "-" ? "bg-bnot-red/[0.08]" : "";
    const textColor =
      marker === "+" ? "text-bnot-green" : marker === "-" ? "text-bnot-red" : "text-white/55";
    // Match the surrounding terminal's font-size + leading so diff rows read
    // as part of the same stream rather than a tighter block pasted in. The
    // per-row py-px nudge adds a hairline of breathing room that differentiates
    // adjacent +/- rows without breaking the monospaced rhythm.
    return (
      <div
        className={`flex gap-2 py-px px-1 font-mono text-[11px] leading-[1.6] ${rowBg}`}
        style={style}
      >
        <span className={`w-2.5 shrink-0 text-center ${textColor}`}>
          {marker === " " ? "" : marker}
        </span>
        <span className="w-7 shrink-0 text-right text-white/30">{num}</span>
        {/* whitespace-pre keeps leading indentation visible (otherwise the
            browser collapses runs of spaces to one); parent overflow:hidden
            handles clipping for any line that outruns the terminal width. */}
        <span className={`whitespace-pre ${textColor}`}>{line.text}</span>
      </div>
    );
  }
  if (line.kind === "bootSprite") {
    const traits = line.color ? bnotTraitsFromId(`${line.id}-sprite`, undefined) : undefined;
    return (
      <div className={`flex items-center gap-3 my-1 ${className}`} style={style}>
        <div className="shrink-0">
          <PixelBnot color={line.color ?? "green"} isActive traits={traits} size="xl" />
        </div>
        <div className="flex flex-col gap-0.5 text-[11px] leading-[1.5]">
          {line.text.split("\n").map((t, i) => (
            <span key={i} className={i === 0 ? "font-semibold text-white/90" : "text-white/60"}>
              {t}
            </span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className={className} style={style}>
      {line.text}
    </div>
  );
}
