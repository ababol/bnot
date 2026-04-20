import { type RefObject, useEffect, useRef, useState } from "react";
import type { Phases } from "../lib/demo-state";
import type { Tab } from "../lib/tabs";

type CursorPos = { x: number; y: number };
export type CursorVariant = "arrow" | "pointer";

/** Fallback transition duration applied to the seed teleport and idle drift —
 *  scripted beats override this via `target.moveMs`. */
const DEFAULT_MOVE_MS = 700;

type AutoplayTarget = {
  selector: string;
  /** ms to wait after the tab state settles before starting the cursor move. */
  settleMs: number;
  /** ms the cursor takes to move to the target. Surfaced through the hook
   *  so `FakeCursor` can apply a matching `transition-duration` per step
   *  — that way each beat can pick its own pace without drift between the
   *  CSS transition and the click timer. */
  moveMs: number;
  /** Cursor shape to use once the cursor lands on the target. "pointer" for
   *  clickable bnot UI inside the notch, "arrow" for chrome elsewhere
   *  (e.g. the GitHub browser). */
  variant: CursorVariant;
};

/** Walk the state machine: given (tabId, phases, notchExpanded), what should
 *  the cursor click next? Returns null when nothing should be done in this
 *  tick (mid-transition, or we've already handled this state). settleMs
 *  leaves breathing room for the tab-enter animation to settle so the user
 *  catches where the cursor starts; moveMs matches the CSS transform
 *  transition duration. */
function targetFor(tab: Tab, phases: Phases, notchExpanded: boolean): AutoplayTarget | null {
  if (tab.id === "launch" && phases.launch.kind === "idle") {
    return {
      selector: '[data-autoplay="launch-primary"]',
      settleMs: 1000,
      moveMs: 700,
      // Pointer (pointing-hand) because the target is the "Open in worktree"
      // button — the hand is the universal web cue for "this is clickable",
      // so it flips on as soon as the cursor starts heading there.
      variant: "pointer",
    };
  }
  if (tab.id === "approve" && phases.approve.kind === "idle") {
    // Exploration moved to Launch, so Approve opens with the diff (notch) +
    // question (terminal) already on screen. The cursor only needs to wait
    // long enough for the user to read the diff before clicking Yes.
    return {
      selector: '[data-autoplay="approve-primary"]',
      settleMs: 1470,
      moveMs: 700,
      variant: "pointer",
    };
  }
  if (
    tab.id === "approve" &&
    (phases.approve.kind === "approved" || phases.approve.kind === "always")
  ) {
    // Two-beat transition. After Yes the notch auto-compacts; once the phase
    // resolves the compact chrome shows a green "done" check. The cursor
    // first heads to the compact notch to re-expand it (so the panel's
    // Worktrees pill becomes a reachable click target), then slides to that
    // pill on the next effect tick to nav to Resume.
    if (!notchExpanded) {
      return {
        selector: '[data-autoplay="approve-expand"]',
        settleMs: 300,
        moveMs: 500,
        variant: "pointer",
      };
    }
    return {
      selector: '[data-autoplay="approve-next"]',
      // Coupled to the notch width/height spring in dynamic-notch.module.css —
      // see the comment there.
      settleMs: 400,
      moveMs: 600,
      variant: "pointer",
    };
  }
  if (tab.id === "resume" && phases.resume.kind === "idle") {
    return {
      selector: '[data-autoplay="resume-primary"]',
      settleMs: 800,
      moveMs: 700,
      variant: "pointer",
    };
  }
  return null;
}

/** Scripted cursor that drives the demo hands-free.
 *
 *  Looks up the current autoplay target via a data-attribute, moves the fake
 *  cursor to its center, and fires a real `.click()` — so the interactive and
 *  hands-off paths share one code path (the existing React handlers do the
 *  work). The first real user click inside the demo area cancels autopilot
 *  for the rest of the session; autopilot also pauses while the demo is
 *  scrolled off screen. */
export function useAutoplay(
  tab: Tab,
  phases: Phases,
  demoAreaRef: RefObject<HTMLElement | null>,
  resumeKey: number = 0,
  notchExpanded: boolean = true,
): {
  cursorPos: CursorPos | null;
  cancelled: boolean;
  cursorVariant: CursorVariant;
  cursorMoveMs: number;
} {
  const [cursorPos, setCursorPos] = useState<CursorPos | null>(null);
  const [cursorVariant, setCursorVariant] = useState<CursorVariant>("arrow");
  const [cursorMoveMs, setCursorMoveMs] = useState<number>(DEFAULT_MOVE_MS);
  const [cancelled, setCancelled] = useState(false);
  const [visible, setVisible] = useState(false);
  const cancelledRef = useRef(cancelled);
  cancelledRef.current = cancelled;

  // Re-arm autopilot when the caller bumps `resumeKey` — used when the user
  // clicks a hero-narrator pill to re-enter the scripted demo after a manual
  // click cancelled it. On every bump (skipping the initial 0-mount) we also
  // teleport the fake cursor back to its seed position and reset the cursor
  // shape to the plain arrow, so the replay reads as a fresh entry rather
  // than "continuing from wherever the cursor was last stationed".
  useEffect(() => {
    if (resumeKey === 0) return;
    setCancelled(false);
    setCursorVariant("arrow");
    const area = demoAreaRef.current;
    if (!area) return;
    const r = area.getBoundingClientRect();
    setCursorPos({ x: r.width * 0.82, y: r.height * 0.78 });
  }, [resumeKey, demoAreaRef]);

  // Cancel autopilot on the first real user click / touch inside the demo.
  // Autopilot clicks are fired programmatically via .click(), which does NOT
  // produce a trusted pointer event (event.isTrusted === false), so we can
  // tell them apart from real user input.
  useEffect(() => {
    const area = demoAreaRef.current;
    if (!area) return;
    const onInput = (e: Event) => {
      if (!(e as MouseEvent).isTrusted) return;
      setCancelled(true);
    };
    area.addEventListener("click", onInput, true);
    area.addEventListener("touchstart", onInput, true);
    return () => {
      area.removeEventListener("click", onInput, true);
      area.removeEventListener("touchstart", onInput, true);
    };
  }, [demoAreaRef]);

  // Pause scheduling when the demo isn't on screen — keeps autopilot idle
  // until the user scrolls the hero into view.
  useEffect(() => {
    const area = demoAreaRef.current;
    if (!area || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.35),
      { threshold: [0, 0.35, 1] },
    );
    io.observe(area);
    return () => io.disconnect();
  }, [demoAreaRef]);

  // Seed the cursor at a visible starting point the first time the demo
  // becomes visible. Without this the cursor would teleport straight onto the
  // target on its first move (no prior transform → CSS transition skips).
  useEffect(() => {
    if (cancelled) return;
    if (!visible) return;
    const area = demoAreaRef.current;
    if (!area) return;
    setCursorPos((prev) => {
      if (prev) return prev;
      const r = area.getBoundingClientRect();
      return { x: r.width * 0.82, y: r.height * 0.78 };
    });
  }, [cancelled, visible, demoAreaRef]);

  useEffect(() => {
    if (cancelled) return;
    if (!visible) return;
    const target = targetFor(tab, phases, notchExpanded);
    if (!target) {
      // No scripted target for this (tab, phase) beat — cursor is idling
      // between actions, so it should wear the plain arrow, not the
      // button-hover hand left over from the previous target.
      setCursorVariant("arrow");
      return;
    }
    const area = demoAreaRef.current;
    if (!area) return;

    let clickTimer: number | null = null;
    const moveTimer = window.setTimeout(() => {
      const el = area.querySelector<HTMLElement>(target.selector);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const areaRect = area.getBoundingClientRect();
      setCursorMoveMs(target.moveMs);
      setCursorPos({
        x: rect.left - areaRect.left + rect.width / 2,
        y: rect.top - areaRect.top + rect.height / 2,
      });
      // Flip the cursor shape the moment we start the move toward this
      // target — so by the time the cursor is over the notch, it's already
      // wearing the pointer affordance instead of the plain arrow.
      setCursorVariant(target.variant);
      clickTimer = window.setTimeout(() => {
        if (cancelledRef.current) return;
        // Re-query in case the DOM changed during the move.
        const fresh = area.querySelector<HTMLElement>(target.selector);
        fresh?.click();
        // Click landed — the cursor is no longer "on a button", so drop
        // the hand affordance until the next target picks it up again.
        setCursorVariant("arrow");
      }, target.moveMs);
    }, target.settleMs);

    return () => {
      window.clearTimeout(moveTimer);
      if (clickTimer !== null) window.clearTimeout(clickTimer);
    };
    // `setPhase` spreads a fresh top-level object on every update, so
    // listing the whole `phases` here would reschedule timers on any
    // unrelated phase change. `targetFor` only reads `.kind` off each slice,
    // so the kind triple is what actually drives the effect.
  }, [
    tab.id,
    phases.launch.kind,
    phases.approve.kind,
    phases.resume.kind,
    cancelled,
    visible,
    demoAreaRef,
    notchExpanded,
  ]);

  return { cursorPos, cancelled, cursorVariant, cursorMoveMs };
}
