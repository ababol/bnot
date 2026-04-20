import { Github } from "lucide-react";
import { memo } from "react";

export const HeroCopy = memo(function HeroCopy() {
  return (
    <div className="relative isolate px-6 pt-24 pb-12 max-w-5xl mx-auto text-center">
      {/* Aurora halo — two overlapping bnot-green blobs drifting behind the
          h1. Pointer-events disabled so the CTAs underneath stay clickable. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div
          className="absolute left-1/2 top-[8%] h-[420px] w-[720px] -translate-x-1/2 blur-3xl animate-[hero-aurora-a_18s_ease-in-out_infinite] motion-reduce:animate-none"
          style={{
            background:
              "radial-gradient(closest-side, var(--color-bnot-green-halo-edge), transparent 70%)",
          }}
        />
        <div
          className="absolute left-[58%] top-[18%] h-[320px] w-[480px] -translate-x-1/2 blur-3xl animate-[hero-aurora-b_24s_ease-in-out_infinite] motion-reduce:animate-none"
          style={{
            background: "radial-gradient(closest-side, rgba(74, 222, 128, 0.14), transparent 70%)",
          }}
        />
      </div>

      {/* Gradient wrapped in a span so the bg-clip-text mask stops before
          the green `notch.` accent. */}
      <h1 className="text-4xl sm:text-5xl md:text-6xl font-semibold leading-[1.05] tracking-[-0.03em] mb-6">
        <span
          className="bg-clip-text text-transparent"
          style={{
            backgroundImage: "var(--gradient-display-text)",
            textShadow: "var(--text-shadow-display)",
          }}
        >
          Claude Code,
          <br />
          live in your{" "}
        </span>
        <span className="text-bnot-green/95">notch.</span>
      </h1>

      <p className="text-balance text-sm md:text-base text-text-secondary mb-10 max-w-2xl mx-auto leading-relaxed">
        Every session, every worktree. One glance, one keystroke away. The Mac notch is now mission
        control for every Claude Code agent you've got running.
      </p>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <a
          href="https://github.com/ababol/bnot/releases/latest"
          target="_blank"
          rel="noreferrer"
          className="btn-glass btn-glass-lg"
        >
          <AppleLogo />
          Download for Free
        </a>
        <a
          href="https://github.com/ababol/bnot"
          target="_blank"
          rel="noreferrer"
          className="btn-dark btn-dark-lg"
        >
          <Github className="w-[18px] h-[18px]" />
          View on GitHub
        </a>
      </div>
    </div>
  );
});

function AppleLogo() {
  return (
    <svg viewBox="0 0 384 512" aria-hidden="true" className="w-[18px] h-[18px]" fill="currentColor">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}
