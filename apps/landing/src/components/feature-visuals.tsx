import { GitBranch } from "lucide-react";

import type { BnotColor, BnotTraits } from "../lib/colors";
import PixelBnot from "./pixel-bnot";

/* Live session radar — concentric green pulses with three discovered bnots. */
export function SessionRadar() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative h-[200px] w-[200px]">
        {[0, 0.9, 1.8, 2.7].map((delay, i) => (
          <span
            key={i}
            className="absolute inset-0 rounded-full border border-bnot-green/25 animate-[radar-pulse_3.6s_cubic-bezier(0.2,0.8,0.2,1)_infinite]"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <PixelBnot color="green" size="xl" />
        </div>
        <div className="absolute left-[8%] top-[60%]">
          <PixelBnot color="orange" size="lg" />
        </div>
        <div className="absolute right-[8%] top-[18%]">
          <PixelBnot color="purple" size="lg" />
        </div>
      </div>
    </div>
  );
}

/* Worktree stack — four branch rows, two live, sorted by recency. */
const WORKTREES: Array<{ branch: string; color: BnotColor; active: boolean; time: string }> = [
  { branch: "feature/notch-animations", color: "green", active: true, time: "2m" },
  { branch: "fix/keyboard-jump", color: "orange", active: false, time: "12m" },
  { branch: "design/landing-cards", color: "purple", active: true, time: "1h" },
  { branch: "refactor/state-machine", color: "blue", active: false, time: "3h" },
];

export function WorktreeStack() {
  return (
    <div className="absolute inset-0 flex items-center px-6">
      <div className="flex w-full flex-col gap-1.5">
        {WORKTREES.map((w, i) => (
          <div
            key={i}
            className="flex items-center gap-2.5 rounded-lg border border-white/[0.04] bg-white/[0.025] px-3 py-2"
          >
            <PixelBnot color={w.color} size="sm" />
            <GitBranch className="h-3 w-3 shrink-0 text-text-dim" strokeWidth={1.6} />
            <span className="font-mono text-[11px] text-white/85 truncate min-w-0 flex-1">
              {w.branch}
            </span>
            <span className="font-mono text-[10px] text-text-dim tabular-nums">{w.time}</span>
            <span
              className={[
                "h-1.5 w-1.5 rounded-full",
                w.active ? "bg-bnot-green animate-pulse-dot" : "bg-white/15",
              ].join(" ")}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* Approval card — mock permission prompt with diff and Approve/Deny. */
export function ApprovalCard() {
  return (
    <div className="absolute inset-0 flex items-center justify-center px-6">
      <div className="w-full max-w-[280px] rounded-xl border border-white/[0.08] bg-black/55 p-3 shadow-2xl backdrop-blur-sm">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="rounded bg-bnot-orange/15 px-1.5 py-0.5 font-mono text-[9px] font-medium text-bnot-orange">
            EDIT
          </span>
          <span className="font-mono text-[10px] text-text-muted truncate">
            apps/web/src/index.css
          </span>
        </div>
        <div className="mb-2.5 space-y-0.5 rounded-md bg-black/40 p-2 font-mono text-[10px] leading-relaxed">
          <div className="text-bnot-red/85">- background: #000;</div>
          <div className="text-bnot-green/85">+ background: #0a0a0a;</div>
        </div>
        <div className="flex gap-1.5">
          <button className="flex-1 rounded-md bg-bnot-green/15 py-1.5 text-[11px] font-medium text-bnot-green">
            Approve
          </button>
          <button className="flex-1 rounded-md bg-white/[0.05] py-1.5 text-[11px] font-medium text-text-muted">
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}

/* Context bar — token counter with live fill and auto-compact threshold. */
export function ContextBar() {
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-3 px-8">
      <div className="flex items-baseline gap-2">
        <span className="text-[36px] font-medium leading-none tracking-[-0.03em] text-text-primary tabular-nums">
          23,847
        </span>
        <span className="text-base text-text-dim tabular-nums">/ 200K</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full w-[12%] rounded-full bg-bnot-green" />
      </div>
      <div className="flex items-center justify-between text-[11px] text-text-dim">
        <span>12% of context used</span>
        <span>Auto-compact at 85%</span>
      </div>
    </div>
  );
}

/* Chrome PR — mock GitHub PR header with the Open in worktree CTA. */
export function ChromePR() {
  return (
    <div className="absolute inset-0 flex items-center justify-center px-6">
      <div className="w-full max-w-[300px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#0d1117] shadow-2xl">
        <div className="flex items-center gap-1.5 border-b border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-red-500/70" />
          <span className="h-2 w-2 rounded-full bg-yellow-500/70" />
          <span className="h-2 w-2 rounded-full bg-green-500/70" />
          <span className="ml-2 font-mono text-[10px] text-white/40">github.com</span>
        </div>
        <div className="space-y-2 p-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-bnot-green/15 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase text-bnot-green">
              Open
            </span>
            <span className="truncate text-[11px] font-medium text-white/85">
              feat: notch animations
            </span>
          </div>
          <div className="font-mono text-[10px] text-white/45">ababol:feature/notch-animations</div>
          <button className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md bg-bnot-green py-1.5 text-[11px] font-medium text-black">
            <GitBranch className="h-3 w-3" strokeWidth={2} />
            Open in worktree
          </button>
        </div>
      </div>
    </div>
  );
}

/* Bnot gallery — six deterministic pixel-art characters with varied traits. */
const SAMPLES: Array<{ color: BnotColor; traits: BnotTraits }> = [
  { color: "green", traits: { hat: "cap", ears: "both", eyes: "normal" } },
  { color: "orange", traits: { hat: "horn", ears: "left", eyes: "winkLeft" } },
  { color: "purple", traits: { hat: "crown", ears: "both", eyes: "normal" } },
  { color: "blue", traits: { hat: "none", ears: "floppy", eyes: "normal" } },
  { color: "pink", traits: { hat: "cap", ears: "both", eyes: "winkRight" } },
  { color: "cyan", traits: { hat: "horn", ears: "right", eyes: "normal" } },
];

export function BnotGallery() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="grid grid-cols-3 gap-x-10 gap-y-7">
        {SAMPLES.map((s, i) => (
          <div key={i} className="flex items-center justify-center">
            <PixelBnot color={s.color} traits={s.traits} size="xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
