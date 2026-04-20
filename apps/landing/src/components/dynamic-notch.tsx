import type { Phases, TabId, TerminalLine } from "../lib/demo-state";
import type { Tab } from "../lib/tabs";
import { TABS } from "../lib/tabs";
import { PanelBody, PanelHeader } from "./bnot-panel";
import { CompactNotchLayer } from "./compact-notch-layer";
import styles from "./dynamic-notch.module.css";

type DynamicNotchProps = {
  activeTabId: Tab["id"];
  phases: Phases;
  expanded: boolean;
  resumedBranches: string[];
  focusedTerminalId: string | null;
  innerTabOverride: "sessions" | null;
  onToggle: () => void;
  onCollapse: () => void;
  onPhaseChange: <K extends TabId>(key: K, value: Phases[K]) => void;
  onCompleteAction: () => void;
  onAppendTerminal: (sessionId: string, line: TerminalLine) => void;
  onFocusTerminal: (sessionId: string | null) => void;
  onFocusSessionCard: (sessionId: string) => void;
  onSwitchTab: (id: TabId) => void;
};

const NOTCH_SIZE: Record<Tab["id"], { w: number; h: number }> = {
  // Launch reserves room for LaunchCard + billing-webhooks card pre-click, then
  // checkout-redirect slides into the same frame post-click (no resize jitter).
  launch: { w: 560, h: 370 },
  approve: { w: 500, h: 380 },
  resume: { w: 560, h: 390 },
};

const NOTCH_SIZE_MOBILE: Record<Tab["id"], { w: number; h: number }> = {
  launch: { w: 320, h: 360 },
  approve: { w: 320, h: 370 },
  resume: { w: 320, h: 370 },
};

const COMPACT_W = 320;
const COMPACT_H = 42;
const COMPACT_W_MOBILE = 240;
const COMPACT_H_MOBILE = 38;

export function DynamicNotch({
  activeTabId,
  phases,
  expanded,
  resumedBranches,
  focusedTerminalId,
  innerTabOverride,
  onToggle,
  onCollapse,
  onPhaseChange,
  onCompleteAction,
  onAppendTerminal,
  onFocusTerminal,
  onFocusSessionCard,
  onSwitchTab,
}: DynamicNotchProps) {
  const expandedSize = NOTCH_SIZE[activeTabId];
  const expandedMobile = NOTCH_SIZE_MOBILE[activeTabId];

  const w = expanded ? expandedSize.w : COMPACT_W;
  const h = expanded ? expandedSize.h : COMPACT_H;
  const wMobile = expanded ? expandedMobile.w : COMPACT_W_MOBILE;
  const hMobile = expanded ? expandedMobile.h : COMPACT_H_MOBILE;

  // Any click that bubbles here is a chrome click — interactive children
  // stopPropagation in their own handlers. Mirrors the real app's
  // click-notch toggle behavior (compact-view.tsx:96).
  const handleNotchClick = () => onToggle();

  // Cursor leaving the expanded notch collapses it — matches the macOS
  // DynamicNotch behavior where moving off the expanded panel snaps it back
  // to compact. Only fires while expanded so a compact-state mouseleave
  // doesn't retrigger anything.
  const handleMouseLeave = expanded ? () => onCollapse() : undefined;

  const activeTab = TABS.find((t) => t.id === activeTabId)!;

  // While the compact notch carries the post-Yes "done" check, the autopilot
  // targets it to re-expand — marker only applies when Approve has actually
  // resolved, so other compact states (Launch idle, Resume compact) don't
  // accidentally become click targets.
  const approveSettled = phases.approve.kind === "approved" || phases.approve.kind === "always";
  const autoplayExpandHere = !expanded && activeTabId === "approve" && approveSettled;

  return (
    <div
      className="dn-wrap absolute top-0 left-1/2 -translate-x-1/2 z-30 flex justify-center pointer-events-none"
      style={
        {
          "--dn-w": `${w}px`,
          "--dn-h": `${h}px`,
          "--dn-w-mobile": `${wMobile}px`,
          "--dn-h-mobile": `${hMobile}px`,
        } as React.CSSProperties
      }
    >
      <div
        className={[
          styles.notch,
          "pointer-events-auto notch-clickable",
          expanded ? "rounded-b-[18px] max-sm:rounded-b-[14px]" : "rounded-b-[14px]",
        ].join(" ")}
        onClick={handleNotchClick}
        onMouseLeave={handleMouseLeave}
        role="button"
        tabIndex={-1}
        aria-label={expanded ? "Collapse notch" : "Expand notch"}
        data-autoplay={autoplayExpandHere ? "approve-expand" : undefined}
      >
        {expanded ? (
          TABS.map((t) => (
            <div
              key={t.id}
              data-layer={t.id}
              className={[styles.layer, t.id === activeTabId ? styles.layerActive : ""].join(" ")}
              aria-hidden={t.id !== activeTabId}
            >
              <div className="flex h-full w-full flex-col">
                <PanelHeader
                  view={t.panel}
                  innerTabOverride={innerTabOverride}
                  onSwitchTab={onSwitchTab}
                  onClose={onCollapse}
                />
                <PanelBody
                  view={t.panel}
                  tabId={t.id}
                  phases={phases}
                  isActive={t.id === activeTabId}
                  resumedBranches={resumedBranches}
                  innerTabOverride={innerTabOverride}
                  focusedTerminalId={focusedTerminalId}
                  onPhaseChange={onPhaseChange}
                  onCompleteAction={onCompleteAction}
                  onAppendTerminal={onAppendTerminal}
                  onFocusTerminal={onFocusTerminal}
                  onFocusSessionCard={onFocusSessionCard}
                />
              </div>
            </div>
          ))
        ) : (
          <CompactNotchLayer
            tab={activeTab}
            phases={phases}
            resumedBranches={resumedBranches}
            focusedTerminalId={focusedTerminalId}
          />
        )}
      </div>
    </div>
  );
}
