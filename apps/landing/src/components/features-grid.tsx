import type { ComponentType } from "react";

import { ExternalLink } from "./external-link";
import {
  ApprovalCard,
  BnotGallery,
  ChromePR,
  ContextBar,
  SessionRadar,
  WorktreeStack,
} from "./feature-visuals";

type Feature = {
  title: string;
  body: string;
  Visual: ComponentType;
};

const FEATURES: Feature[] = [
  {
    title: "Live session radar",
    body: "Every running Claude Code session lands in your notch automatically. No setup, no config, no surprises.",
    Visual: SessionRadar,
  },
  {
    title: "Worktrees, always at hand",
    body: "Every worktree you've spun up, sorted by recency. Live sessions wear a badge so you spot them instantly.",
    Visual: WorktreeStack,
  },
  {
    title: "Approve from the notch",
    body: "Permission requests show up with diff previews. Approve, deny, or allow-always, without leaving the notch.",
    Visual: ApprovalCard,
  },
  {
    title: "Context at a glance",
    body: "Following your context size has never been easier. Auto-compact respected, no guesswork before hitting the wall.",
    Visual: ContextBar,
  },
  {
    title: "Chrome extension",
    body: "Jump from any GitHub PR straight into a fresh worktree. Skip the checkout dance, skip the tab hunt.",
    Visual: ChromePR,
  },
  {
    title: "A bnot per session",
    body: "A unique face per worktree, color-matched to its Claude tab. Tell your sessions apart at a glance.",
    Visual: BnotGallery,
  },
];

export function FeaturesGrid() {
  return (
    <section id="features" className="relative max-w-6xl mx-auto px-6 pt-32 sm:pt-40 pb-16">
      <div className="max-w-3xl mb-16 sm:mb-20">
        <p className="text-[11px] uppercase tracking-[0.22em] text-text-secondary font-medium mb-4">
          Features
        </p>
        <h2 className="text-4xl md:text-5xl font-medium tracking-[-0.02em] leading-[1.1] text-text-primary">
          Everything you need to run many agents at once.
        </h2>
        <p className="mt-5 text-lg text-text-secondary leading-relaxed max-w-xl">
          Bnot is built around one bet: the fastest path to the right session is a glance, not a tab
          hunt. Here's what makes that work.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {FEATURES.map((feature) => (
          <FeatureCard key={feature.title} {...feature} />
        ))}
      </div>

      <div className="mt-16 flex">
        <ExternalLink href="https://github.com/ababol/bnot#features">
          See the full feature list on GitHub
        </ExternalLink>
      </div>
    </section>
  );
}

function FeatureCard({ title, body, Visual }: Feature) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-page-surface transition-colors hover:border-white/[0.1]">
      <div className="relative h-[240px] overflow-hidden bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.04),transparent_55%)]">
        <Visual />
      </div>
      <div className="border-t border-white/[0.04] px-7 pt-6 pb-7">
        <h3 className="mb-2 text-lg font-medium tracking-[-0.01em] text-text-primary">{title}</h3>
        <p className="text-[15px] leading-relaxed text-text-secondary">{body}</p>
      </div>
    </div>
  );
}
