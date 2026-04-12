import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { useSession } from "../context/session-context";
import { contextPercent, isWorking } from "../context/types";
import { useHeroSession } from "../hooks/use-hero-session";
import { useTimer } from "../hooks/use-timer";
import type { BnotColor } from "../lib/colors";
import { bnotTraitsFromId, MAIN_COLORS, parseBnotColor, sessionStatusDot } from "../lib/colors";
import { setPanelState } from "../lib/tauri";
import PixelBell from "./pixel-bell";
import PixelBnot from "./pixel-bnot";
import StatusIndicator from "./status-indicator";

interface Props {
  notchWidth: number;
}

export default function CompactView({ notchWidth }: Props) {
  const { state, dispatch } = useSession();
  const sessions = state.sessions;
  const heroSession = useHeroSession();
  const sessionCount = Object.values(sessions).filter((s) => s.status !== "completed").length;
  const hasApproval = Object.values(sessions).some(
    (s) => s.status === "waitingApproval" || s.status === "waitingAnswer",
  );
  const notchGap = notchWidth + 16;
  const heroPct = heroSession ? contextPercent(heroSession) : 0;
  const barColor: BnotColor = heroPct > 0.85 ? "red" : heroPct > 0.6 ? "orange" : "green";
  const heroSuffix = heroSession ? (heroSession.gitWorktree ?? heroSession.gitBranch ?? "") : "";
  const heroTraits = heroSession
    ? bnotTraitsFromId(heroSession.workingDirectory + heroSuffix, heroSuffix || undefined)
    : undefined;
  const now = useTimer();
  const heroIsWorking = heroSession ? isWorking(heroSession, now) : false;
  const heroColor: BnotColor =
    parseBnotColor(heroSession?.agentColor) ?? heroTraits?.color ?? "gray";
  const heroDot = heroSession
    ? sessionStatusDot(heroSession.status, heroIsWorking, heroSession.sessionMode)
    : undefined;

  // Reconcile if sessions change while we're in a collapsed state: widen to
  // alert when something needs attention, or shrink back once it's handled.
  useEffect(() => {
    if (state.panelState === "compact" && hasApproval) {
      setPanelState(dispatch, "alert");
    } else if (state.panelState === "alert" && !hasApproval) {
      setPanelState(dispatch, "compact");
    }
  }, [state.panelState, hasApproval, dispatch]);

  const hoverTimer = useRef<number | null>(null);
  const openOverview = () => {
    const pendingApproval = Object.values(sessions).some((s) => s.status === "waitingApproval");
    const pendingQuestion = Object.values(sessions).some((s) => s.status === "waitingAnswer");
    const target = pendingApproval ? "approval" : pendingQuestion ? "ask" : "overview";
    setPanelState(dispatch, target);
  };
  const handleEnter = () => {
    if (hoverTimer.current !== null) return;
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      openOverview();
    }, 150);
  };
  const handleLeave = () => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  // Native cursor-tracking from Rust: fires even when window is not focused.
  // Require the cursor to leave the trigger zone at least once after mount before
  // honoring a hover-to-open — otherwise closing the overview with the cursor still
  // parked on the notch instantly re-opens it.
  useEffect(() => {
    let sawExit = false;
    let unlisten: (() => void) | null = null;
    listen<{ trigger: boolean; zone: boolean }>("notch-hover", (event) => {
      if (!event.payload.trigger) {
        sawExit = true;
        handleLeave();
      } else if (sawExit) {
        handleEnter();
      }
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      unlisten?.();
      handleLeave();
    };
  }, [dispatch]);

  return (
    <div
      onClick={openOverview}
      className="flex h-full w-full cursor-pointer items-center rounded-b-[10px] bg-black"
    >
      {/* Left wing */}
      <div className="flex flex-1 items-center justify-start pl-2">
        <div className="flex items-center">
          {heroSession && (
            <div className="relative mr-0.5 h-[18px] w-[5px] overflow-hidden rounded-sm bg-white/10">
              <div
                className="absolute bottom-0 w-full rounded-sm"
                style={{
                  height: `${Math.max(Math.min(heroPct, 1) * 100, 10)}%`,
                  backgroundColor: MAIN_COLORS[barColor],
                }}
              />
            </div>
          )}
          <PixelBnot color={heroColor} isActive={heroIsWorking} traits={heroTraits} size="lg" />
          {heroDot && (
            <div className="ml-0.5">
              <StatusIndicator dot={heroDot} size="lg" />
            </div>
          )}
        </div>
      </div>

      {/* Center notch dead zone */}
      <div className="shrink-0" style={{ width: notchGap }} />

      {/* Right wing */}
      <div className="flex flex-1 items-center justify-end gap-1 pr-2">
        {hasApproval && <PixelBell />}
        {sessionCount > 0 ? (
          <div className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-surface-active text-[11px] font-bold tabular-nums text-text-secondary">
            {sessionCount}
          </div>
        ) : state.history.length > 0 ? (
          <div className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-surface text-[11px] font-bold tabular-nums text-text-dim">
            {state.history.length}
          </div>
        ) : null}
      </div>
    </div>
  );
}
