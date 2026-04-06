import { invoke } from "@tauri-apps/api/core";
import { useSession } from "../context/session-context";
import { contextPercent } from "../context/types";
import type { BuddyColor } from "../lib/colors";
import { buddyTraitsFromId, MAIN_COLORS } from "../lib/colors";
import PixelBuddy from "./pixel-buddy";

interface Props {
  notchWidth: number;
}

export default function CompactView({ notchWidth }: Props) {
  const { state, dispatch } = useSession();
  const sessions = state.sessions;
  const heroSession = state.heroSessionId ? sessions[state.heroSessionId] : undefined;
  const sessionCount = Object.keys(sessions).length;
  const isJump = state.panelState === "jump";

  const notchGap = notchWidth + 16;
  const heroPct = heroSession ? contextPercent(heroSession) : 0;
  const barColor: BuddyColor = heroPct > 0.85 ? "red" : heroPct > 0.6 ? "orange" : "green";
  const heroSuffix = heroSession ? (heroSession.gitWorktree ?? heroSession.gitBranch ?? "") : "";
  const heroTraits = heroSession
    ? buddyTraitsFromId(heroSession.workingDirectory + heroSuffix)
    : undefined;
  const heroIsWorking = heroSession ? heroSession.status === "active" && heroSession.cpuPercent >= 2.0 : false;
  const heroColor: BuddyColor = heroSession
    ? heroSession.status === "waitingApproval" ? "orange"
      : heroSession.status === "waitingAnswer" ? "cyan"
      : heroSession.status === "error" ? "red"
      : heroIsWorking ? (heroTraits?.color ?? "green")
      : "gray"
    : "gray";

  const handleClick = () => {
    if (sessionCount === 0) return;
    dispatch({ type: "SET_PANEL_STATE", panelState: "overview" });
    invoke("set_panel_state", { state: "overview" });
  };

  return (
    <div
      onClick={handleClick}
      className={`flex h-full w-full items-center rounded-b-[10px] bg-black/85 ${sessionCount > 0 ? "cursor-pointer" : "cursor-default"}`}
    >
      {/* Left wing */}
      <div className="flex flex-1 items-center justify-start pl-2">
        {isJump ? (
          <span className="text-base text-buddy-green">&#x2713;</span>
        ) : (
          <div className="flex items-center gap-1">
            <PixelBuddy color={heroColor} isActive={heroIsWorking} traits={heroTraits} />
            {heroSession && (
              <div className="relative h-[14px] w-[4px] overflow-hidden rounded-sm bg-white/10">
                <div
                  className="absolute bottom-0 w-full rounded-sm"
                  style={{
                    height: `${Math.max(Math.min(heroPct, 1) * 100, 10)}%`,
                    backgroundColor: MAIN_COLORS[barColor],
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Center notch dead zone */}
      <div className="shrink-0" style={{ width: notchGap }} />

      {/* Right wing */}
      <div className="flex flex-1 items-center justify-end pr-2">
        {sessionCount > 0 && (
          <div className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-surface-active text-[11px] font-bold tabular-nums text-text-secondary">
            {sessionCount}
          </div>
        )}
      </div>
    </div>
  );
}
