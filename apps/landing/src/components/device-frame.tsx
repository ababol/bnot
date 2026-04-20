import { useRef } from "react";
import { useAutoplay } from "../hooks/use-autoplay";
import type { Phases, TabId, TerminalActions, TerminalLine } from "../lib/demo-state";
import type { Tab } from "../lib/tabs";
import styles from "./device-frame.module.css";
import { DynamicNotch } from "./dynamic-notch";
import { FakeCursor } from "./fake-cursor";
import { GithubBrowser } from "./github-browser";
import { Terminals } from "./terminals";

type DeviceFrameProps = {
  tab: Tab;
  phases: Phases;
  notchExpanded: boolean;
  focusedTerminalId: string | null;
  terminalActions: TerminalActions;
  resumedBranches: string[];
  innerTabOverride: "sessions" | null;
  autoplayResumeKey: number;
  onPause: () => void;
  onResume: () => void;
  onNotchToggle: () => void;
  onNotchCollapse: () => void;
  onPhaseChange: <K extends TabId>(key: K, value: Phases[K]) => void;
  onCompleteAction: () => void;
  onAppendTerminal: (sessionId: string, line: TerminalLine) => void;
  onFocusTerminal: (sessionId: string | null) => void;
  onFocusSessionCard: (sessionId: string) => void;
  onSwitchTab: (id: TabId) => void;
};

export function DeviceFrame({
  tab,
  phases,
  notchExpanded,
  focusedTerminalId,
  terminalActions,
  resumedBranches,
  innerTabOverride,
  autoplayResumeKey,
  onPause,
  onResume,
  onNotchToggle,
  onNotchCollapse,
  onPhaseChange,
  onCompleteAction,
  onAppendTerminal,
  onFocusTerminal,
  onFocusSessionCard,
  onSwitchTab,
}: DeviceFrameProps) {
  const demoAreaRef = useRef<HTMLDivElement | null>(null);
  const { cursorPos, cancelled, cursorVariant } = useAutoplay(
    tab,
    phases,
    demoAreaRef,
    autoplayResumeKey,
    notchExpanded,
  );

  // Only an active mouse-move on the demo pauses the autopilot — a stale
  // hover from page-scrolling past the demo doesn't count, so the cycle
  // keeps playing until the user actually intends to interact.
  const handleMove = () => onPause();
  const handleLeave = () => onResume();

  return (
    <div
      ref={demoAreaRef}
      className={`${styles.demoArea} relative max-w-6xl mx-auto px-4 sm:px-6 animate-fade-in-up`}
      style={{ animationDelay: "0.65s" }}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      {/* Outer device frame — light chrome around a pastoral macOS desktop */}
      <div className="relative rounded-[28px] sm:rounded-[36px] overflow-hidden border border-page-border-strong bg-page-surface-2 shadow-[0_40px_90px_-30px_rgba(15,15,20,0.35)] h-[540px] sm:h-[620px] md:h-[660px]">
        {/* Pastoral desktop wallpaper */}
        <img
          src={`${import.meta.env.BASE_URL}hero.webp`}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover scale-105"
          loading="eager"
        />
        {/* Much lighter overlay so the wallpaper can breathe */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/25" />
        <div className="grain absolute inset-0 opacity-40" />

        {/* Fake macOS menubar */}
        <div className="absolute top-0 inset-x-0 h-7 z-10 flex items-center px-4 text-[11px] text-white/90 font-medium pointer-events-none bg-gradient-to-b from-black/40 to-transparent">
          <span className="flex items-center gap-3">
            <AppleGlyph />
            <span>Bnot</span>
            <span className="text-white/65">File</span>
            <span className="text-white/65">Edit</span>
            <span className="text-white/65">View</span>
            <span className="text-white/65">Window</span>
          </span>
          <span className="ml-auto text-white/75 font-mono text-[11px]">Fri 4:29 PM</span>
        </div>

        {/* GitHub browser — only on the Launch tab */}
        {tab.panel.mode === "launch" && (
          <GithubBrowser
            intent={tab.panel.intent}
            phase={phases.launch}
            isActive
            newcomerId={tab.panel.newcomer.id}
            onPhaseChange={onPhaseChange}
            onCompleteAction={onCompleteAction}
            onFocusTerminal={onFocusTerminal}
          />
        )}

        {/* Fake terminal — one Ghostty window with one tab per session */}
        <Terminals
          tab={tab}
          phases={phases}
          focusedId={focusedTerminalId}
          actions={terminalActions}
          onSelectTerminalTab={onFocusTerminal}
        />

        {/* Dynamic Notch — the centerpiece morph animation */}
        <DynamicNotch
          activeTabId={tab.id}
          phases={phases}
          expanded={notchExpanded}
          resumedBranches={resumedBranches}
          focusedTerminalId={focusedTerminalId}
          innerTabOverride={innerTabOverride}
          onToggle={onNotchToggle}
          onCollapse={onNotchCollapse}
          onPhaseChange={onPhaseChange}
          onCompleteAction={onCompleteAction}
          onAppendTerminal={onAppendTerminal}
          onFocusTerminal={onFocusTerminal}
          onFocusSessionCard={onFocusSessionCard}
          onSwitchTab={onSwitchTab}
        />

        {/* Fake cursor — drives to autopilot targets. Visible until the user
            actually clicks (cancelled=true), so even when a real cursor hovers
            the frame, the demo narrative keeps playing. */}
        {!cancelled && <FakeCursor pulseKey={tab.id} autoPos={cursorPos} variant={cursorVariant} />}

        {/* Soft bottom fade so the "desktop" blends into the page */}
        <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-page-bg/80 via-page-bg/15 to-transparent pointer-events-none z-20" />
      </div>
    </div>
  );
}

function AppleGlyph() {
  return (
    <svg width="12" height="14" viewBox="0 0 170 170" fill="currentColor" aria-hidden="true">
      <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.197-2.12-9.973-3.17-14.34-3.17-4.58 0-9.492 1.05-14.746 3.17-5.262 2.13-9.501 3.24-12.742 3.35-4.929.21-9.842-1.96-14.746-6.52-3.13-2.73-7.045-7.41-11.735-14.04-5.032-7.08-9.169-15.29-12.41-24.65-3.471-10.11-5.211-19.9-5.211-29.38 0-10.86 2.346-20.22 7.045-28.07 3.693-6.3 8.606-11.27 14.755-14.92 6.149-3.65 12.793-5.51 19.948-5.629 3.915 0 9.049 1.211 15.43 3.591 6.359 2.388 10.448 3.599 12.256 3.599 1.351 0 5.892-1.417 13.592-4.239 7.282-2.618 13.424-3.701 18.449-3.275 13.607 1.098 23.821 6.463 30.61 16.126-12.172 7.376-18.192 17.697-18.073 30.954.11 10.328 3.86 18.928 11.23 25.768 3.34 3.13 7.066 5.554 11.232 7.275-.911 2.633-1.87 5.169-2.893 7.603zM119.012 5.69c0 8.095-2.958 15.658-8.848 22.669-7.115 8.341-15.72 13.163-25.055 12.403-.124-1.06-.181-2.18-.181-3.369 0-7.758 3.381-15.766 9.388-22.584 2.986-3.42 6.775-6.265 11.358-8.536 4.577-2.229 8.897-3.462 12.961-3.705.111 1.147.167 2.193.167 3.211z" />
    </svg>
  );
}
