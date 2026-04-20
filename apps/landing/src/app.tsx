import { memo, useCallback, useEffect, useRef, useState } from "react";
import { BnotMark } from "./components/bnot-mark";
import { DeviceFrame } from "./components/device-frame";
import { Faq } from "./components/faq";
import { FeaturesGrid } from "./components/features-grid";
import { HeroCopy } from "./components/hero-copy";
import { HeroNarrator } from "./components/hero-narrator";
import { LogoStrip } from "./components/logo-strip";
import { Nav } from "./components/nav";
import { useTabCycle } from "./hooks/use-tab-cycle";
import {
  initialPhases,
  type Phases,
  type TabId,
  type TerminalActions,
  type TerminalLine,
} from "./lib/demo-state";
import { TABS } from "./lib/tabs";

// Post-action pulse: how long the bar races toward 100% before the cycle
// advances. Per-tab because each beat has a different "feels right" landing:
//   launch  — 800ms: the default 2s cubic easeOut sits at ~99% for ~500ms
//             and reads as "blocked"; 800ms keeps the deceleration off-screen.
//   approve — 2000ms: Approve doesn't actually call pulsePause (autopilot
//             cuts directly via setActive when it clicks the Worktrees pill),
//             so this value only covers generic toggleNotch completions.
//   resume  — 500ms: Resume is the terminal beat (non-loop), so this just
//             races the bar to 100% alongside the worktree click.
const PULSE_MS: Record<TabId, number> = { launch: 800, approve: 2000, resume: 500 };
// Cap the resumed-branch history — in a demo that stays on one page for a
// long session with autopilot hammering worktree clicks, the list would
// otherwise grow unbounded even though re-renders are deduped.
const MAX_RESUMED = 10;
// Per-tab cycle durations (natural-advance ceiling before the scripted
// pulsePause fires). Keyed by id so reordering TABS can't silently misalign
// the timings; flattened to the positional array useTabCycle expects below.
const INTERVAL_MS: Record<TabId, number> = { launch: 10000, approve: 8000, resume: 2500 };
const INTERVALS_BY_INDEX = TABS.map((t) => INTERVAL_MS[t.id]);

export function App() {
  // Tracks whether the user's real cursor is actively moving on the demo.
  // Combined with the current phase below into a *contextual* pause: the
  // cycle only freezes when the user is hovering AND the demo is waiting on
  // them (idle phase with a button to click). Claude's "thinking" beats —
  // the typewriter, ✱ Processing, the working spinner, the resumed pill —
  // keep playing regardless so the demo doesn't stall mid-animation.
  const [mouseOnDemo, setMouseOnDemo] = useState(false);
  // Mirror of `mouseOnDemo` readable from effects that shouldn't re-run on
  // hover changes (e.g. the tab-change reset below re-arms the scripted
  // cursor only if the user's mouse isn't currently on the demo).
  const mouseOnDemoRef = useRef(mouseOnDemo);
  mouseOnDemoRef.current = mouseOnDemo;
  const [paused, setPaused] = useState(false);
  // Seed from the initial tab so Launch doesn't paint an expanded notch for
  // one frame before the [active] effect collapses it — otherwise the very
  // first visible frame of the demo is the wrong one.
  const [notchExpanded, setNotchExpanded] = useState(() => TABS[0].id !== "launch");
  const [phases, setPhases] = useState<Phases>(() => initialPhases());
  const [focusedTerminalId, setFocusedTerminalId] = useState<string | null>(null);
  const [terminalActions, setTerminalActions] = useState<TerminalActions>({});
  // Worktrees the user (or autopilot) has resumed — they stack onto the
  // Sessions list in the panel as synthesized, active-looking sessions
  // (newest first). The order is "latest click first", so storing as an
  // insertion list and rendering reversed gives DESC naturally.
  const [resumedBranches, setResumedBranches] = useState<string[]>([]);
  // Overrides the inner-pill derivation inside the notch. Null means "use
  // the default for the current main tab" (sessions for Launch/Approve,
  // worktrees for Resume). "sessions" means force the Sessions view even
  // on Resume — set after a worktree-resume click and when the user clicks
  // the Sessions inner pill on Resume. Cleared whenever the main tab
  // changes so the next scripted step starts from its natural default.
  const [innerTabOverride, setInnerTabOverride] = useState<"sessions" | null>(null);
  // Monotonic counter bumped when the user re-enters the scripted demo via
  // the hero-narrator pills. Passed to `useAutoplay` so it can un-cancel
  // itself and bring the fake cursor back — clicking Launch after cancelling
  // should visually restart the demo, not leave a ghost tab with no cursor.
  const [autoplayResumeKey, setAutoplayResumeKey] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // When the user clicks an inner Sessions/Worktrees pill (inside the
  // expanded notch) the hood-level main tab changes too — but the notch
  // should stay open across that flip. This ref is set by the inner-pill
  // callback right before setActive fires, so the `[active]` reset effect
  // can skip its default "Launch → compact, others → expanded" rule for
  // that single transition.
  const preserveNotchOnTabChangeRef = useRef(false);

  // Per-tab durations reflect each beat's actual scripted length:
  //   Launch — 10s (GitHub browser → boot → typewriter → Processing →
  //            exploration → advance)
  //   Approve — 8s (autopilot settles on Yes, reaches the Edit success,
  //            glides to the Worktrees pill)
  //   Resume — 2.5s (autopilot's cursor travel time; bar hits 100% right
  //            as the worktree is clicked and the notch compacts)
  // `loop={false}` makes Resume terminal; the bar then caps at 100%.
  // Interactive clicks end with pulsePause(PULSE_MS[tabId]) which takes
  // over the remaining time and either advances to the next tab or,
  // on Resume, just completes the bar.
  const [active, setActive, progress, pulsePause] = useTabCycle(
    TABS.length,
    INTERVALS_BY_INDEX,
    paused,
    false,
  );

  const tab = TABS[active];

  // Sync `paused` from the contextual derivation. We can't compute paused
  // inline because the deciding tab id only exists after useTabCycle resolves
  // `active`, and useTabCycle accepts paused as input. Effect-then-state
  // breaks the cycle with a one-render delay.
  useEffect(() => {
    const waitingForInput =
      (tab.id === "launch" && phases.launch.kind === "idle") ||
      (tab.id === "approve" && phases.approve.kind === "idle") ||
      (tab.id === "resume" && phases.resume.kind === "idle");
    setPaused(mouseOnDemo && waitingForInput);
  }, [mouseOnDemo, phases, tab.id]);

  // Reset per-tab state whenever the active tab changes. The hero-narrator
  // path fully resets (phases, notch, terminal) so the tab replays from a
  // clean slate. The inner Sessions/Worktrees pills set the preserve ref
  // first — they just swap the panel view, they don't mean "replay this
  // tab", so the reset is skipped entirely and the user's demo progress
  // (phases, focused terminal, scripted lines, notch expansion) stays put.
  useEffect(() => {
    if (preserveNotchOnTabChangeRef.current) {
      preserveNotchOnTabChangeRef.current = false;
      return;
    }
    setPhases(initialPhases());
    // Launch tab opens compact so the fake GitHub browser is the star.
    setNotchExpanded(TABS[active].id !== "launch");
    setFocusedTerminalId(null);
    setTerminalActions({});
    // Inner override only applies within a single tab's session — on a real
    // tab change (narrator click or autopilot advance) drop it so Resume
    // reopens showing Worktrees, not a stale Sessions override.
    setInnerTabOverride(null);
    // Re-arm the scripted cursor on each step change unless the user is
    // still hovering. Without this, a single trusted click earlier in the
    // page cancels the fake cursor for the rest of the session. Read
    // `mouseOnDemo` via ref so this effect doesn't re-fire on hover flips.
    if (!mouseOnDemoRef.current) setAutoplayResumeKey((k) => k + 1);
  }, [active]);

  // Play a short chime whenever Claude's permission-request alert first
  // appears in the notch — the audible counterpart to the bell pixel.
  // Fails silently if the browser is blocking autoplay (no user gesture yet).
  useEffect(() => {
    if (tab.id !== "approve") return;
    if (phases.approve.kind !== "idle") return;
    playAlertSound(audioCtxRef);
  }, [tab.id, phases.approve.kind]);

  // Once a worktree is opened on the Resume tab, collapse the notch back to
  // its compact form so the terminal underneath becomes the focus — the
  // user already made their selection; the panel's job is done. Watch the
  // full `phases.resume` object (not just `kind`) so a second worktree
  // click — where kind stays "opened" and only `branch` changes — also
  // re-compacts after a manual re-expand. Also flip the inner pill to
  // "sessions" so when the user reopens the notch they land on the sessions
  // list (now that a worktree has been picked, the worktree grid's job is
  // done and the natural next thing is to interact with the running agents).
  useEffect(() => {
    if (phases.resume.kind === "opened") {
      setNotchExpanded(false);
      setInnerTabOverride("sessions");
    }
  }, [phases.resume]);

  // Track the resume-click history; `resumedBranches` is the list the
  // panel uses to synthesize Session cards (DESC / newest first). Returning
  // `prev` when the branch is already at the front short-circuits the
  // re-render cascade for a re-click that doesn't actually change the list.
  useEffect(() => {
    if (phases.resume.kind !== "opened") return;
    const branch = phases.resume.branch;
    setResumedBranches((prev) => {
      if (prev[0] === branch) return prev;
      return [branch, ...prev.filter((b) => b !== branch)].slice(0, MAX_RESUMED);
    });
  }, [phases.resume]);

  // Approval click collapses the notch so the terminal stage takes over while
  // the edit applies. The re-expand beat is NOT done here — it's driven by
  // the autopilot's cursor, which moves to the compact notch (wearing the
  // green "done" check once phase settles), clicks it to expand, then slides
  // to the Worktrees pill. Keeps the narrative "the cursor is visibly doing
  // this" instead of a silent auto-expand.
  useEffect(() => {
    if (phases.approve.kind === "working") setNotchExpanded(false);
  }, [phases.approve.kind]);

  const setPhase = useCallback(<K extends TabId>(key: K, value: Phases[K]) => {
    setPhases((p) => ({ ...p, [key]: value }));
  }, []);

  const appendTerminal = useCallback((sessionId: string, line: TerminalLine) => {
    setTerminalActions((prev) => ({
      ...prev,
      [sessionId]: [...(prev[sessionId] ?? []), line],
    }));
  }, []);

  const toggleNotch = useCallback(() => {
    setNotchExpanded((v) => !v);
    pulsePause(PULSE_MS[TABS[active].id]);
  }, [pulsePause, active]);

  const collapseNotch = useCallback(() => {
    // Shared collapse handler for the X button in the panel header and the
    // notch-mouseleave edge. Doesn't fire pulsePause — leaving a notch you
    // weren't interacting with shouldn't also act as "user action, advance".
    setNotchExpanded(false);
  }, []);

  const completeAction = useCallback(() => {
    // User finished an action (approve/deny/submit/jump) — race the bar to
    // 100% over this tab's pulse window, then advance (except on Resume,
    // which is terminal — there the pulse just completes the bar in place).
    pulsePause(PULSE_MS[TABS[active].id]);
  }, [pulsePause, active]);

  const switchToTab = useCallback(
    (id: TabId) => {
      const idx = TABS.findIndex((t) => t.id === id);
      if (idx < 0) return;
      setActive(idx);
    },
    [setActive],
  );

  // Version of `switchToTab` used by the inner Sessions/Worktrees pills
  // inside the expanded notch. Asymmetric on purpose:
  //   - "sessions" pill (id === "launch") → just sets the inner override. No
  //     main tab change, no phase reset, no cycle restart. Clicking Sessions
  //     from Resume shouldn't yank the user back to the Launch narrative.
  //   - "worktrees" pill (id === "resume") → if we're not already on Resume,
  //     advance the main tab (this path is how autopilot completes
  //     Approve → Resume). Preserve ref keeps phases intact on that
  //     transition. If we're already on Resume, just clear the override so
  //     the panel flips from SessionList back to WorktreeList.
  const switchInnerTab = useCallback(
    (id: TabId) => {
      const currentId = TABS[active]?.id;
      if (id === "launch") {
        setInnerTabOverride("sessions");
        return;
      }
      if (id === "resume") {
        if (currentId === "resume") {
          setInnerTabOverride(null);
          return;
        }
        preserveNotchOnTabChangeRef.current = true;
        switchToTab(id);
      }
    },
    [active, switchToTab],
  );

  const focusSessionFromCard = useCallback((sessionId: string) => {
    // Clicking a session card in the expanded notch: focus its terminal
    // tab and collapse the notch so the terminal takes the stage. Matches
    // the "click worktree → compact + focus" flow users already know.
    setFocusedTerminalId(sessionId);
    setNotchExpanded(false);
  }, []);

  return (
    <div className="min-h-screen relative overflow-hidden">
      <Nav />

      <main className="relative">
        <HeroCopy />
        <DeviceFrame
          tab={tab}
          phases={phases}
          notchExpanded={notchExpanded}
          focusedTerminalId={focusedTerminalId}
          terminalActions={terminalActions}
          resumedBranches={resumedBranches}
          innerTabOverride={innerTabOverride}
          autoplayResumeKey={autoplayResumeKey}
          onPause={() => setMouseOnDemo(true)}
          onResume={() => setMouseOnDemo(false)}
          onNotchToggle={toggleNotch}
          onNotchCollapse={collapseNotch}
          onPhaseChange={setPhase}
          onCompleteAction={completeAction}
          onAppendTerminal={appendTerminal}
          onFocusTerminal={setFocusedTerminalId}
          onFocusSessionCard={focusSessionFromCard}
          onSwitchTab={switchInnerTab}
        />
        <HeroNarrator
          tabs={TABS}
          active={active}
          progress={progress}
          onSelect={(i) => {
            // Narrator click is the user's "rewind / replay this step"
            // signal — bump the autoplay key so the fake cursor comes back
            // even if an earlier trusted click had cancelled autopilot.
            setActive(i);
            setAutoplayResumeKey((k) => k + 1);
          }}
        />
        <LogoStrip />
        <FeaturesGrid />
        <Faq />
      </main>

      <Footer />
    </div>
  );
}

const FOOTER_SECTIONS: Array<{
  heading: string;
  links: Array<{ label: string; href: string }>;
}> = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "FAQ", href: "#faq" },
      {
        label: "Download",
        href: "https://github.com/ababol/bnot/releases/latest/download/Bnot.dmg",
      },
    ],
  },
  {
    heading: "Community",
    links: [
      { label: "GitHub", href: "https://github.com/ababol/bnot" },
      { label: "Report an issue", href: "https://github.com/ababol/bnot/issues" },
      { label: "Releases", href: "https://github.com/ababol/bnot/releases" },
    ],
  },
  {
    heading: "Legal",
    links: [{ label: "FSL License", href: "https://github.com/ababol/bnot/blob/main/LICENSE" }],
  },
];

const Footer = memo(function Footer() {
  return (
    <footer className="border-t border-page-border px-6 pt-16 pb-10">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <BnotMark />
            <p className="mt-4 max-w-[220px] text-sm leading-relaxed text-text-secondary">
              A Dynamic Notch for Claude Code sessions, right in your menu bar.
            </p>
          </div>
          {FOOTER_SECTIONS.map((section) => (
            <div key={section.heading}>
              <h3 className="text-sm font-medium text-text-primary">{section.heading}</h3>
              <ul className="mt-4 flex flex-col gap-2.5">
                {section.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm text-text-secondary transition-colors hover:text-text-primary"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-16 flex flex-col gap-2 border-t border-page-border pt-6 text-xs text-text-secondary sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Bnot</span>
          <span>Made with care · FSL License</span>
        </div>
      </div>
    </footer>
  );
});

/** Short two-tone ping matching the bell pixel — fired when Claude's
 *  approval request lands in the notch. Web Audio so no asset is needed. */
function playAlertSound(ctxRef: React.MutableRefObject<AudioContext | null>) {
  if (typeof window === "undefined" || !window.AudioContext) return;
  try {
    if (!ctxRef.current) ctxRef.current = new window.AudioContext();
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const ping = (freq: number, offset: number, peak: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(peak, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + duration);
    };
    ping(1318.5, 0, 0.1, 0.35);
    ping(1760, 0.08, 0.08, 0.4);
  } catch {
    // Autoplay blocked before first user gesture — silent no-op.
  }
}
