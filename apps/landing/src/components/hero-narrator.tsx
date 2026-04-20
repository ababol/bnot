import type { Tab } from "../lib/tabs";
import styles from "./hero-narrator.module.css";

const NARRATIVES: Record<Tab["id"], { title: string; description: string }> = {
  launch: {
    title: "From GitHub to Bnot.",
    description:
      "Jump from any GitHub issue into a fresh worktree. Skip the checkout dance, skip the tab hunt.",
  },
  approve: {
    title: "Permissions in the notch.",
    description:
      "Every permission request lands with a full diff preview. Approve, deny, or allow-always without leaving the notch.",
  },
  resume: {
    title: "Every session, one keystroke.",
    description:
      "Every worktree is one click away. Active sessions snap to their Ghostty tab; idle ones spin up a fresh resume.",
  },
};

const INACTIVE_W = 60;
const ACTIVE_W = 120;
const SEGMENT_GAP = 16;

type HeroNarratorProps = {
  tabs: Tab[];
  active: number;
  progress: number;
  onSelect: (i: number) => void;
};

export function HeroNarrator({ tabs, active, progress, onSelect }: HeroNarratorProps) {
  // The track always has 1 active + (n-1) inactive segments, so total width is
  // constant across tab changes. The active segment grows to ACTIVE_W while
  // the others stay at INACTIVE_W, so the highlight's left offset is simply
  // `active * (INACTIVE_W + gap)` — every segment before the active one is
  // guaranteed to be INACTIVE_W wide.
  const trackWidth = ACTIVE_W + (tabs.length - 1) * INACTIVE_W + (tabs.length - 1) * SEGMENT_GAP;
  const highlightLeft = active * (INACTIVE_W + SEGMENT_GAP);
  return (
    <section className="max-w-5xl mx-auto px-6 pt-12 pb-16">
      {/* Indicator — three baseline segments where the active one is wider,
          plus a single sliding green-glow highlight that overlays them. The
          highlight translates across positions and carries a localized radial
          halo that rides the progress front. */}
      <div className="relative mx-auto mb-10 flex justify-center">
        <div
          className="hero-narrator-track relative flex"
          style={{ width: `${trackWidth}px`, gap: `${SEGMENT_GAP}px` }}
        >
          {tabs.map((t, i) => {
            const isActive = i === active;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelect(i)}
                aria-label={`Jump to ${t.label}`}
                className={styles.segment}
                data-active={isActive}
                style={{ width: `${isActive ? ACTIVE_W : INACTIVE_W}px` }}
              />
            );
          })}
          <div
            className={styles.highlight}
            style={{
              width: `${ACTIVE_W}px`,
              transform: `translate3d(${highlightLeft}px, 0, 0)`,
            }}
            aria-hidden="true"
          >
            <span
              className={styles.progress}
              style={{ transform: `scaleX(${Math.max(0.001, progress)})` }}
            />
            {/* Glow travels with the progress front — a small radial hot-spot
                rather than a blanket halo behind the whole bar. */}
            <span className={styles.halo} style={{ left: `${progress * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
        {tabs.map((t, i) => {
          const isActive = i === active;
          const copy = NARRATIVES[t.id];
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(i)}
              className={`text-left cursor-pointer transition-opacity duration-500 ease-out ${
                isActive ? "opacity-100" : "opacity-50 hover:opacity-100"
              }`}
              aria-pressed={isActive}
            >
              <p className="text-sm md:text-[15px] leading-relaxed font-medium">
                <span className="text-text-primary">{copy.title}</span>{" "}
                <span className="text-text-secondary">{copy.description}</span>
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
