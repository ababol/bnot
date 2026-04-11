import { useSession } from "../context/session-context";
import { contextPercent, isWorking } from "../context/types";
import { useHeroSession } from "../hooks/use-hero-session";
import { useTimer } from "../hooks/use-timer";
import type { BuddyColor } from "../lib/colors";
import { buddyTraitsFromId, BUDDY_COLORS_RGB, parseBuddyColor, sessionStatusDot } from "../lib/colors";
import { setPanelState } from "../lib/tauri";
import PixelBuddy from "./pixel-buddy";

interface Props {
  notchWidth: number;
}

export default function CompactView({ notchWidth }: Props) {
  const { state, dispatch } = useSession();
  const sessions = state.sessions;
  const heroSession = useHeroSession();
  const sessionCount = Object.values(sessions).filter((s) => s.status !== "completed").length;
  const isJump = state.panelState === "jump";

  const notchGap = notchWidth + 16;
  const heroPct = heroSession ? contextPercent(heroSession) : 0;
  const barColor: BuddyColor = heroPct > 0.85 ? "red" : heroPct > 0.6 ? "orange" : "green";
  const heroSuffix = heroSession ? (heroSession.gitWorktree ?? heroSession.gitBranch ?? "") : "";
  const heroTraits = heroSession
    ? buddyTraitsFromId(heroSession.workingDirectory + heroSuffix, heroSuffix || undefined)
    : undefined;
  const now = useTimer();
  const heroIsWorking = heroSession ? isWorking(heroSession, now) : false;
  const heroColor: BuddyColor =
    parseBuddyColor(heroSession?.agentColor) ?? heroTraits?.color ?? "gray";
  const heroDot = heroSession
    ? sessionStatusDot(heroSession.status, heroIsWorking, heroSession.sessionMode)
    : undefined;

  const handleClick = () => {
    setPanelState(dispatch, "overview");
  };

  return (
    <div
      onClick={handleClick}
      className="flex h-full w-full cursor-pointer items-center rounded-b-[10px] bg-black"
    >
      {/* Left wing */}
      <div className="flex flex-1 items-center justify-start pl-2">
        {isJump ? (
          <span className="text-base text-buddy-green">&#x2713;</span>
        ) : (
          <div className="flex items-center gap-1">
            <PixelBuddy
              color={heroColor}
              isActive={heroIsWorking}
              traits={heroTraits}
              dot={heroDot}
            />
            {heroSession && (
              <div className="relative h-[14px] w-[4px] overflow-hidden rounded-sm bg-white/10">
                <div
                  className="absolute bottom-0 w-full rounded-sm"
                  style={{
                    height: `${Math.max(Math.min(heroPct, 1) * 100, 10)}%`,
                    backgroundColor: BUDDY_COLORS_RGB[barColor],
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
