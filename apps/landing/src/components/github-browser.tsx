import { Github } from "lucide-react";
import type { MouseEvent } from "react";
import type { LaunchPhase, Phases, TabId } from "../lib/demo-state";
import type { LaunchIntent } from "../lib/tabs";
import styles from "./github-browser.module.css";

type GithubBrowserProps = {
  intent: LaunchIntent;
  phase: LaunchPhase;
  isActive: boolean;
  newcomerId: string;
  onPhaseChange: <K extends TabId>(key: K, value: Phases[K]) => void;
  onCompleteAction: () => void;
  onFocusTerminal: (sessionId: string | null) => void;
};

export function GithubBrowser({
  intent,
  phase,
  isActive,
  newcomerId,
  onPhaseChange,
  onCompleteAction,
  onFocusTerminal,
}: GithubBrowserProps) {
  const clickable = isActive && phase.kind === "idle";
  const launched = phase.kind === "launched";

  const handle = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!clickable) return;
    onPhaseChange("launch", { kind: "launched" });
    onFocusTerminal(newcomerId);
    // Ghostty rises (~0.5s), boot, typewriter (~1.2s), ✳ Processing, then
    // 3 exploration lines stagger in (terminals.tsx reveal chain tails at
    // ~3.8s including the 0.4s fade). 4000ms leaves ~200ms to read the
    // last line before the Launch pulse fires and advances to Approve.
    window.setTimeout(() => onCompleteAction(), 4000);
  };

  return (
    <div
      className={[
        "absolute left-1/2 top-[52px] z-[8] w-[860px] max-w-[94%] -translate-x-1/2 transition-[opacity,transform] duration-500 ease-out",
        launched
          ? "opacity-0 pointer-events-none translate-y-2 scale-[0.98]"
          : "opacity-100 pointer-events-auto",
      ].join(" ")}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0d1117] shadow-[0_28px_80px_-20px_rgba(0,0,0,0.7),0_8px_20px_-8px_rgba(0,0,0,0.5)]">
        {/* Chrome tab strip — single tab */}
        <div className="flex items-center gap-2 bg-[#1a1d22] px-3 pt-2">
          <div className="flex shrink-0 gap-1.5 pb-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="ml-2 flex items-end overflow-hidden">
            <div className="flex h-[28px] max-w-[360px] items-center gap-1.5 rounded-t-md bg-[#0d1117] px-3 text-[11px] text-white/90">
              <GithubFavicon />
              <span className="truncate">
                Fix checkout redirect loop · Pull Request #{intent.issueNumber} · ababol/
                {intent.repoName}
              </span>
            </div>
          </div>
          <button
            disabled
            className="ml-1 mb-1.5 text-[14px] leading-none text-white/30"
            aria-label="New tab"
          >
            +
          </button>
        </div>
        {/* Sticky GitHub top nav */}
        <div className="flex items-center gap-3 border-b border-white/[0.08] bg-[#0d1117] px-4 py-2">
          <MenuIcon />
          <Github className="h-[18px] w-[18px] text-white/95" strokeWidth={1.6} />
          <div className="flex items-center gap-1.5 text-[12px]">
            <span className="text-white/65">ababol</span>
            <span className="text-white/25">/</span>
            <span className="font-semibold text-white">{intent.repoName}</span>
          </div>
          <div className="ml-3 flex min-w-0 flex-1 items-center gap-2 rounded-md border border-white/10 bg-[#161b22] px-2.5 py-[3px] text-[10.5px] text-white/40">
            <SearchIcon />
            <span className="truncate">Type </span>
            <kbd className="rounded border border-white/10 bg-white/[0.04] px-[5px] py-px text-[9px] text-white/55">
              /
            </kbd>
            <span>to search</span>
          </div>
          <button className="shrink-0 text-white/50" aria-label="Notifications">
            <BellIcon />
          </button>
          <div className="h-5 w-5 shrink-0 rounded-full bg-gradient-to-br from-cyan-400/50 to-blue-500/40" />
        </div>

        {/* Repo tabs */}
        <div className="flex items-end gap-5 border-b border-white/[0.08] bg-[#0d1117] px-4 text-[11px] text-white/55">
          <RepoTab label="Code" />
          <RepoTab label="Issues" count={3} />
          <RepoTab label="Pull requests" count={1} active />
          <RepoTab label="Actions" />
          <RepoTab label="Projects" />
          <RepoTab label="Insights" />
        </div>

        {/* PR header */}
        <div className="bg-[#0d1117] px-4 pb-3 pt-3">
          <div className="flex items-start gap-3">
            <h2 className="flex-1 text-[18px] font-semibold leading-[1.25] text-white">
              Fix checkout redirect loop{" "}
              <span className="font-normal text-white/35">#{intent.issueNumber}</span>
            </h2>
            <button
              data-autoplay="launch-primary"
              disabled={!clickable}
              onClick={handle}
              className={
                launched
                  ? styles.openButtonLaunched
                  : clickable
                    ? styles.openButtonIdle
                    : styles.openButtonDisabled
              }
            >
              <BnotMark />
              <span>{launched ? "Opening worktree…" : "Open in worktree"}</span>
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-white/55">
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#238636] px-2.5 py-[3px] text-[10.5px] font-semibold text-white">
              <OpenDot /> Open
            </span>
            <span>
              <span className="font-semibold text-white/80">ababol</span> wants to merge{" "}
              <span className="font-semibold text-white/80">3 commits</span> into{" "}
              <span className="rounded bg-white/[0.06] px-1.5 py-px font-mono text-[10.5px] text-white/80">
                main
              </span>{" "}
              from{" "}
              <span className="rounded bg-white/[0.06] px-1.5 py-px font-mono text-[10.5px] text-white/80">
                {intent.branch}
              </span>
            </span>
          </div>
        </div>

        {/* PR sub-tabs */}
        <div className="flex items-end gap-5 border-b border-white/[0.08] bg-[#0d1117] px-4 text-[11px] text-white/55">
          <SubTab label="Conversation" count={0} active />
          <SubTab label="Commits" count={3} />
          <SubTab label="Checks" count={0} />
          <SubTab label="Files changed" count={4} />
          <div className="ml-auto py-2 font-mono text-[10.5px]">
            <span className="text-[#3fb950]">+8</span> <span className="text-[#f85149]">−2</span>
          </div>
        </div>

        {/* Comment */}
        <div className="flex gap-2.5 bg-[#0d1117] px-4 py-3.5">
          <div className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-gradient-to-br from-cyan-400/60 to-blue-500/40" />
          <div className="flex-1 overflow-hidden rounded-md border border-white/[0.08] bg-[#0d1117]">
            <div className="flex items-center gap-2 border-b border-white/[0.08] bg-[#161b22] px-3 py-2 text-[10.5px] text-white/55">
              <span className="font-semibold text-white/80">ababol</span>
              <span>commented 2 days ago</span>
              <span className="ml-auto rounded-full border border-white/10 px-2 py-px text-[9.5px] text-white/55">
                Owner
              </span>
            </div>
            <div className="px-3.5 py-3 text-[11.5px] leading-[1.6] text-white/80">
              <p>
                Users are bounced between{" "}
                <code className="rounded bg-white/[0.06] px-1 font-mono text-[10.5px] text-bnot-cyan">
                  /checkout
                </code>{" "}
                and{" "}
                <code className="rounded bg-white/[0.06] px-1 font-mono text-[10.5px] text-bnot-cyan">
                  /login
                </code>{" "}
                after entering payment details. Only reproducible on mobile Safari — suspect the
                session cookie isn't being set before the redirect.
              </p>
              <p className="mt-2 text-white/55">
                Repro steps:
                <br />
                1. Safari iOS 17 → <span className="text-white/80">/checkout</span>
                <br />
                2. Fill card details, hit <span className="text-white/80">Pay</span>
                <br />
                3. Page flickers to <span className="text-white/80">/login</span> and back
              </p>
            </div>
          </div>
        </div>

        {/* Timeline event — lightweight PR metadata row that fills a bit more
            vertical space so the browser covers more of the terminal behind
            it on Launch, without inventing extra narrative content. */}
        <div className="flex items-center gap-2 border-t border-white/[0.04] bg-[#0d1117] px-4 py-2.5 text-[11px] text-white/55">
          <TagIcon />
          <span>
            <span className="font-semibold text-white/75">bnot</span> added the{" "}
            <span className="inline-flex items-center gap-1 rounded-full bg-[#8957e5]/15 px-2 py-px text-[10px] font-medium text-[#a780f0] ring-1 ring-[#8957e5]/30">
              bug
            </span>{" "}
            and{" "}
            <span className="inline-flex items-center gap-1 rounded-full bg-[#f85149]/15 px-2 py-px text-[10px] font-medium text-[#f87171] ring-1 ring-[#f85149]/30">
              mobile
            </span>{" "}
            labels · 2 days ago
          </span>
        </div>
      </div>
    </div>
  );
}

function TagIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-white/45"
    >
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function RepoTab({ label, count, active }: { label: string; count?: number; active?: boolean }) {
  return (
    <div className={[styles.tab, active ? styles.tabActive : ""].join(" ")}>
      <span>{label}</span>
      {typeof count === "number" && (
        <span className={[styles.tabBadge, active ? styles.tabBadgeActive : ""].join(" ")}>
          {count}
        </span>
      )}
      {active && <span className={styles.tabUnderline} />}
    </div>
  );
}

function SubTab({ label, count, active }: { label: string; count?: number; active?: boolean }) {
  return (
    <div className={[styles.tab, active ? styles.tabActive : ""].join(" ")}>
      <span>{label}</span>
      {typeof count === "number" && (
        <span className={[styles.tabBadge, active ? styles.tabBadgeActive : ""].join(" ")}>
          {count}
        </span>
      )}
      {active && <span className={styles.tabUnderline} />}
    </div>
  );
}

function GithubFavicon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="text-white/75 shrink-0"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.92.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.25 3.33.96.1-.74.4-1.25.72-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.78 0c2.21-1.49 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.8 1.18 1.83 1.18 3.09 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.8.56C20.22 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="text-white/70 shrink-0"
    >
      <path d="M1 2.75A.75.75 0 0 1 1.75 2h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 2.75Zm0 5A.75.75 0 0 1 1.75 7h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 7.75ZM1.75 12h12.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5Z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-white/35 shrink-0"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function OpenDot() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
      <path
        fillRule="evenodd"
        d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0Zm0 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z"
      />
    </svg>
  );
}

function BnotMark() {
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-black/25 text-[9px] font-black">
      B
    </span>
  );
}
