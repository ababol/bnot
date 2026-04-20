import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drives the auto-cycling tab demo.
 *
 * Two timers live inside one RAF loop so both stop cleanly when `paused`:
 *   1. **Cycle timer** — per-tab duration from `intervalsMs[activeIndex]`
 *      (falls back to the single `number` form). Progress is preserved
 *      across pauses (hover unhover resumes from the same spot).
 *   2. **Pulse timer** — set by `pulsePause(ms)` after a user action. Counts
 *      down via the RAF loop, so hovering halts it. When it hits zero, the
 *      cycle advances to the next tab. While pulsing, progress races from
 *      wherever the bar was toward 100% via `easeOut`, so the visual reads
 *      "user acted → this beat is wrapping up".
 *
 * `loop` defaults to true (classic carousel — last → first). When false, the
 * cycle stops at the last index instead of wrapping — progress caps at 100%
 * there instead of resetting to 0. Manual `setActive` (a tab-pill click)
 * still works to jump anywhere.
 */
export function useTabCycle(
  count: number,
  intervalMs: number | number[],
  paused: boolean,
  loop: boolean = true,
) {
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);

  const startRef = useRef<number | null>(null);
  const pausedElapsedRef = useRef<number>(0);
  const pulseRemainingRef = useRef<number>(0);
  const pulseTotalRef = useRef<number>(0);
  const pulseStartProgressRef = useRef<number>(0);
  const lastFrameRef = useRef<number | null>(null);
  // Flips true when the last tab (non-loop) finishes its natural tick;
  // tells the RAF loop to stop updating progress so the bar sits at 100%
  // without a per-frame setState churn.
  const heldRef = useRef(false);
  // Keeps the latest `active` reachable from inside the RAF closure without
  // making the effect depend on `active` (which would tear down and rebuild
  // the RAF on every tab change).
  const activeRef = useRef(active);
  activeRef.current = active;
  // Current progress visible to the RAF loop — needed so `pulsePause` can
  // snapshot the bar's position at the moment the user acts.
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useEffect(() => {
    if (paused) {
      // Snapshot how far through the regular cycle we got so we can resume.
      // Don't snapshot if we're mid-pulse — pulseRemainingRef holds that state.
      if (startRef.current !== null && pulseRemainingRef.current === 0) {
        pausedElapsedRef.current = performance.now() - startRef.current;
        startRef.current = null;
      }
      lastFrameRef.current = null;
      return;
    }

    lastFrameRef.current = null;

    const advance = (a: number) => (loop ? (a + 1) % count : Math.min(a + 1, count - 1));
    const durationFor = (a: number) => {
      if (typeof intervalMs === "number") return intervalMs;
      return intervalMs[a] ?? intervalMs[0] ?? 10000;
    };

    let rafId = 0;
    const tick = (now: number) => {
      const dt = lastFrameRef.current === null ? 0 : now - lastFrameRef.current;
      lastFrameRef.current = now;

      if (pulseRemainingRef.current > 0) {
        // Counting down to a forced advance after a user action. Hover pauses
        // the RAF loop, which naturally pauses this countdown too.
        pulseRemainingRef.current -= dt;
        if (pulseRemainingRef.current <= 0) {
          pulseRemainingRef.current = 0;
          pulseTotalRef.current = 0;
          pulseStartProgressRef.current = 0;
          const nextActive = advance(activeRef.current);
          if (nextActive === activeRef.current) {
            // Last tab + non-loop: advance is a no-op, so the pulse is a
            // "complete this beat" signal — hold progress at 100%. Set
            // `heldRef` so subsequent ticks don't bleed the bar back down
            // via the natural-tick path (startRef was cleared by pulse).
            heldRef.current = true;
            setProgress(1);
          } else {
            setActive(nextActive);
            setProgress(0);
            startRef.current = null;
            pausedElapsedRef.current = 0;
          }
        } else if (pulseTotalRef.current > 0) {
          // Race toward 100% over the pulse window — interpolates from
          // whatever the bar showed when the user acted to a full fill by
          // the time the advance fires. Makes the bar feel like a narrative
          // counterpart to the demo's scripted payoff, not a detached timer.
          const consumed = pulseTotalRef.current - pulseRemainingRef.current;
          const k = Math.min(1, Math.max(0, consumed / pulseTotalRef.current));
          const start = pulseStartProgressRef.current;
          setProgress(start + (1 - start) * easeOut(k));
        }
      } else if (!heldRef.current) {
        // Regular cycle progress.
        if (startRef.current === null) {
          // Back-date startRef so the cycle resumes from where it was paused.
          startRef.current = now - pausedElapsedRef.current;
          pausedElapsedRef.current = 0;
        }
        const elapsed = now - startRef.current;
        const pct = elapsed / durationFor(activeRef.current);
        if (pct >= 1) {
          const nextActive = advance(activeRef.current);
          if (nextActive === activeRef.current) {
            // Last tab + non-loop: cycle is complete — hold the bar at
            // 100% instead of resetting. `heldRef` prevents subsequent
            // ticks from pushing progress back down.
            heldRef.current = true;
            setProgress(1);
          } else {
            setActive(nextActive);
            setProgress(0);
            startRef.current = now;
          }
        } else {
          setProgress(pct);
        }
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [count, intervalMs, paused, loop]);

  const select = useCallback((i: number) => {
    setActive(i);
    setProgress(0);
    startRef.current = null;
    pausedElapsedRef.current = 0;
    pulseRemainingRef.current = 0;
    pulseTotalRef.current = 0;
    pulseStartProgressRef.current = 0;
    heldRef.current = false;
  }, []);

  /**
   * After a user action, suppress regular progress and force-advance to the
   * next tab in `ms` milliseconds. The bar eases from its current spot up
   * to 100% across those ms. On the last tab with `loop=false` the advance
   * is a no-op, so this becomes a "complete this beat" signal that just
   * fills the bar.
   */
  const pulsePause = useCallback((ms: number) => {
    pulseRemainingRef.current = ms;
    pulseTotalRef.current = ms;
    pulseStartProgressRef.current = progressRef.current;
    pausedElapsedRef.current = 0;
    startRef.current = null;
    heldRef.current = false;
  }, []);

  return [active, select, progress, pulsePause] as const;
}

/** Cubic ease-out — bar decelerates as it approaches 100%, so the final
 *  sliver reads as "landing" rather than "still ticking". */
function easeOut(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}
