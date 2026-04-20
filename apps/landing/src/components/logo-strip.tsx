import { Apple, Github, Sparkles, SquareTerminal } from "lucide-react";

const ITEMS = [
  { icon: Apple, label: "macOS 14+" },
  { icon: SquareTerminal, label: "Ghostty · iTerm" },
  { icon: Sparkles, label: "Built for Claude Code" },
  { icon: Github, label: "FSL · Open Source" },
];

export function LogoStrip() {
  return (
    <div
      className="mt-20 sm:mt-28 mb-16 max-w-5xl mx-auto px-6 animate-fade-in-up"
      style={{ animationDelay: "0.85s" }}
    >
      <p className="text-center text-[11px] uppercase tracking-[0.2em] text-text-dim font-medium mb-8">
        Designed for the Claude Code workflow
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-10 sm:gap-x-14 gap-y-5">
        {ITEMS.map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-2 text-text-muted">
            <Icon className="w-4 h-4" />
            <span className="text-sm font-medium">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
