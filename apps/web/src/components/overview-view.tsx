import { invoke } from "@tauri-apps/api/core";
import { useSession } from "../context/session-context";
import { buddyColorFromSessions } from "../lib/colors";
import { jumpToSession, setPanelState } from "../lib/tauri";
import HistoryCard from "./history-card";
import PixelBuddy from "./pixel-buddy";
import SessionCard from "./session-card";

interface Props {
  notchHeight: number;
}

export default function OverviewView({ notchHeight }: Props) {
  const { state, dispatch } = useSession();
  const sessions = state.sessions;
  const history = state.history;
  const sortedSessions = Object.values(sessions).sort((a, b) =>
    a.workingDirectory.localeCompare(b.workingDirectory),
  );
  const heroId = state.heroSessionId ?? sortedSessions[0]?.id ?? null;
  const buddyColor = buddyColorFromSessions(sessions);

  const close = () => setPanelState(dispatch, "compact");

  const handleSessionClick = (sessionId: string) => {
    setPanelState(dispatch, "compact");
    setTimeout(() => jumpToSession(sessionId), 80);
  };

  const handleResumeClick = (sessionId: string, projectPath: string) => {
    setPanelState(dispatch, "compact");
    setTimeout(() => invoke("resume_session", { sessionId, projectPath }), 80);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-[10px] bg-black">
      {/* Notch dead zone */}
      <div className="shrink-0" style={{ height: notchHeight }} />

      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 pb-2">
        <PixelBuddy color={buddyColor} isActive={true} />
        <span className="text-xs font-semibold text-text-secondary">Sessions</span>
        <div className="flex-1" />
        <button
          onClick={close}
          className="flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded border-none bg-transparent text-[10px] font-bold text-text-dim hover:text-text-muted"
        >
          &#x2715;
        </button>
      </div>

      {/* Session list */}
      {sortedSessions.length === 0 && history.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-text-dim">
          No sessions
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-3">
          {sortedSessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              isHero={session.id === heroId}
              onClick={() => handleSessionClick(session.id)}
            />
          ))}

          {sortedSessions.length > 0 && history.length > 0 && (
            <div className="flex items-center gap-2 py-1">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-[10px] text-text-dim">Recent</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>
          )}

          {history.map((session) => (
            <HistoryCard
              key={session.sessionId}
              session={session}
              onClick={() => handleResumeClick(session.sessionId, session.projectPath)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
