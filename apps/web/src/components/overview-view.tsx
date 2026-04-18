import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "../context/session-context";
import { needsAttention } from "../context/types";
import { useOverviewKeyboard } from "../hooks/use-overview-keyboard";
import { bnotColorFromSessions } from "../lib/colors";
import { collapsePanel, jumpToSessionAndCollapse } from "../lib/tauri";
import PixelBnot from "./pixel-bnot";
import SessionCard from "./session-card";
import SettingsMenu from "./settings-menu";
import TabBar from "./tab-bar";
import WorktreesView from "./worktrees-view";

interface Props {
  notchHeight: number;
}

export default function OverviewView({ notchHeight }: Props) {
  const { state, dispatch } = useSession();
  const sessions = state.sessions;
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!settingsOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-settings-anchor]")) setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [settingsOpen]);

  const sortedSessions = useMemo(
    () =>
      Object.values(sessions).sort((a, b) => {
        const priorityDelta = Number(needsAttention(b)) - Number(needsAttention(a));
        if (priorityDelta !== 0) return -priorityDelta;
        // Newest first, oldest last — so a session's rank stays stable as
        // newer sessions appear above it, and it drifts toward the bottom.
        return b.startedAt - a.startedAt;
      }),
    [sessions],
  );
  const sortedSessionIds = useMemo(() => sortedSessions.map((s) => s.id), [sortedSessions]);
  const prioritySession = sortedSessions.find(needsAttention);
  const heroId = prioritySession?.id ?? state.heroSessionId ?? sortedSessions[0]?.id ?? null;
  const bnotColor = bnotColorFromSessions(sessions);

  useOverviewKeyboard(sortedSessionIds);

  const close = () => collapsePanel(dispatch, sessions);

  // Collapse when the cursor leaves the expanded zone (native tracking — works
  // even when the window doesn't have focus).
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ trigger: boolean; zone: boolean }>("notch-hover", (event) => {
      if (!event.payload.zone) close();
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      unlisten?.();
    };
  }, [dispatch]);

  const handleSessionClick = (sessionId: string) => {
    jumpToSessionAndCollapse(dispatch, sessions, sessionId);
  };

  const sessionCursor = Math.min(state.sessionsCursor, Math.max(0, sortedSessions.length - 1));

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-[10px] bg-black">
      {/* Notch dead zone */}
      <div className="shrink-0" style={{ height: notchHeight }} />

      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 pb-2">
        <PixelBnot color={bnotColor} isActive={true} />
        <TabBar />
        <div className="flex-1" />
        <div className="relative" data-settings-anchor>
          <button
            onClick={() => setSettingsOpen((v) => !v)}
            title="Settings"
            className={`flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded border-none bg-transparent text-text-dim hover:text-text-muted ${
              settingsOpen ? "bg-white/10 text-text-muted" : ""
            }`}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          {settingsOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-md border border-white/10 bg-black py-1 text-xs text-text-secondary shadow-lg">
              <SettingsMenu onAction={() => setSettingsOpen(false)} />
            </div>
          )}
        </div>
        <button
          onClick={close}
          className="flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded border-none bg-transparent text-[10px] font-bold text-text-dim hover:text-text-muted"
        >
          &#x2715;
        </button>
      </div>

      {/* Body */}
      {state.view === "worktrees" ? (
        <WorktreesView />
      ) : sortedSessions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-text-dim">
          No active sessions
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-3">
          {sortedSessions.map((session, i) => (
            <SessionCard
              key={session.id}
              session={session}
              isHero={session.id === heroId}
              isCursor={i === sessionCursor}
              onClick={() => handleSessionClick(session.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
