import { useEffect, useRef, useState } from "react";
import type { CursorVariant } from "../hooks/use-autoplay";

type FakeCursorProps = {
  pulseKey: unknown;
  /** Absolute (x, y) relative to the demo area. The cursor only renders
   *  once a position is supplied — the autopilot hook seeds it the first
   *  time the demo scrolls into view. */
  autoPos: { x: number; y: number } | null;
  /** "arrow" → classic macOS arrow for idle movement across chrome.
   *  "pointer" → pointing-hand glyph, the web `cursor: pointer` cue, flipped
   *  on the moment the cursor heads toward a clickable target so the
   *  affordance reads before the click lands. */
  variant: CursorVariant;
};

/**
 * Scripted cursor driven by the `useAutoplay` hook. Sits at `autoPos` and
 * transitions smoothly to new positions via CSS — so each move to a button
 * reads like a recorded screencast. Pulses on each tab switch. The variant
 * flips to "pointer" (a pointing hand) the moment the cursor starts moving
 * toward a clickable target, mirroring the browser's native affordance.
 */
export function FakeCursor({ pulseKey, autoPos, variant }: FakeCursorProps) {
  const [pulsing, setPulsing] = useState(false);
  const firstRenderRef = useRef(true);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 500);
    return () => clearTimeout(t);
  }, [pulseKey]);

  if (!autoPos) return null;

  return (
    // z-50 sits above the notch (z-30) and terminals (z-20) inside the device frame.
    <div
      className="absolute left-0 top-0 w-[30px] h-[36px] pointer-events-none z-50 drop-shadow-[0_6px_14px_rgba(0,0,0,0.55)] transition-transform duration-[1050ms] ease-[cubic-bezier(0.2,0.55,0.2,1)]"
      style={{ transform: `translate(${autoPos.x}px, ${autoPos.y}px)` }}
      aria-hidden="true"
    >
      <div
        className={
          pulsing
            ? "w-full h-full animate-[cursor-pulse_0.5s_cubic-bezier(0.2,0.9,0.25,1)]"
            : "w-full h-full"
        }
      >
        {variant === "pointer" ? (
          // macOS-style link cursor: extended index finger with three rounded
          // knuckles curling down into a palm + thumb. White fill with black
          // stroke so the silhouette stays legible on both the light GitHub
          // chrome and the dark notch surface. Only used when the cursor is
          // heading toward or parked on a button/tab/CTA — idling cursor
          // falls back to the plain arrow variant below.
          <svg width="22" height="26" viewBox="0 0 22 26" fill="none" className="w-full h-full">
            <path
              d="M7 2
                 a1.6 1.6 0 0 1 3.2 0
                 V11
                 a1.6 1.6 0 0 1 3.2 0
                 V13
                 a1.6 1.6 0 0 1 3.2 0
                 V14
                 a1.6 1.6 0 0 1 3.2 0
                 V18
                 a5 5 0 0 1-5 5
                 H9
                 c-2 0-3.6-1-4.6-2.6
                 L1.8 16
                 a1.3 1.3 0 0 1 1.8-1.8
                 L7 17
                 Z"
              fill="#ffffff"
              stroke="#000000"
              strokeWidth="1.3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg width="26" height="32" viewBox="0 0 26 32" fill="none" className="w-full h-full">
            {/* Classic macOS cursor — black fill, white outline */}
            <path
              d="M4 3 L4 24 L9 20 L12 27 L15 26 L12 19 L19 19 Z"
              fill="#000"
              stroke="#ffffff"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </div>
  );
}
