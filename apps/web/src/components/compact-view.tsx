import { invoke } from "@tauri-apps/api/core";
import { useSession } from "../context/session-context";
import { contextPercent } from "../context/types";
import { buddyColorFromSessions } from "../lib/colors";
import BuddyBattery from "./buddy-battery";

interface Props {
  notchWidth: number;
}

export default function CompactView({ notchWidth }: Props) {
  const { state, dispatch } = useSession();
  const sessions = state.sessions;
  const heroSession = state.heroSessionId ? sessions[state.heroSessionId] : undefined;
  const sessionCount = Object.keys(sessions).length;
  const isJump = state.panelState === "jump";

  const hasWorkingSessions = Object.values(sessions).some(
    (s) => s.status === "active" && s.cpuPercent >= 2.0,
  );

  const notchGap = notchWidth + 16;
  const buddyColor = buddyColorFromSessions(sessions);

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
          <BuddyBattery
            color={buddyColor}
            percent={heroSession ? contextPercent(heroSession) : 0}
            isActive={hasWorkingSessions}
          />
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
