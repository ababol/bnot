import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef } from "react";
import type { SessionAction } from "../context/session-context";
import {
  PANEL_STATES,
  type AgentSession,
  type HistorySession,
  type HookHealthReport,
  type PanelState,
  type UsageSnapshot,
} from "../context/types";
import { playSound } from "../lib/sound";
import { collapsePanel, setPanelState } from "../lib/tauri";

interface SessionsUpdatedPayload {
  sessions: Record<string, AgentSession>;
  heroId: string | null;
}

function isPanelState(raw: unknown): raw is PanelState {
  return typeof raw === "string" && (PANEL_STATES as readonly string[]).includes(raw);
}

export function useTauriEvents(
  dispatch: React.Dispatch<SessionAction>,
  panelState: string,
  sessions: Record<string, AgentSession>,
) {
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  // Track which session IDs have already had their done sound played to
  // prevent double-firing when two rapid sessionsUpdated events arrive before
  // React re-renders (both would see stale "active" in sessionsRef).
  const playedDoneRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unlisten: Array<() => void> = [];

    listen<SessionsUpdatedPayload>("sessionsUpdated", (event) => {
      dispatch({
        type: "UPDATE_SESSIONS",
        sessions: event.payload.sessions,
        heroId: event.payload.heroId,
      });
    }).then((u) => unlisten.push(u));

    // taskCompleted fires only on genuine task completion (from a success
    // notification in session-manager), not on process death or /exit.
    listen<{ sessionId: string }>("taskCompleted", (event) => {
      const { sessionId } = event.payload;
      if (!playedDoneRef.current.has(sessionId)) {
        playedDoneRef.current.add(sessionId);
        playSound("/done.mp3");
        setTimeout(() => playedDoneRef.current.delete(sessionId), 30_000);
      }
    }).then((u) => unlisten.push(u));

    listen<{ state: string }>("panelStateChange", (event) => {
      const raw = event.payload.state;
      if (!isPanelState(raw)) return;
      if (raw === "alert") {
        playSound("/alert.mp3");
      }
      setPanelState(dispatch, raw);
    }).then((u) => unlisten.push(u));

    listen<{ history: HistorySession[] }>("historyUpdated", (event) => {
      dispatch({ type: "UPDATE_HISTORY", history: event.payload.history });
    }).then((u) => unlisten.push(u));

    listen<HookHealthReport>("hookHealth", (event) => {
      dispatch({ type: "SET_HOOK_HEALTH", hookHealth: event.payload });
    }).then((u) => unlisten.push(u));

    listen<UsageSnapshot>("usageStats", (event) => {
      dispatch({ type: "SET_USAGE_STATS", usageStats: event.payload });
    }).then((u) => unlisten.push(u));

    return () => {
      unlisten.forEach((u) => u());
    };
  }, [dispatch]);

  // Collapse panel when window loses focus (user clicks outside)
  useEffect(() => {
    if (
      panelState === "compact" ||
      panelState === "alert" ||
      panelState === "approval" ||
      panelState === "ask"
    )
      return;

    const win = getCurrentWebviewWindow();
    let unlisten: (() => void) | null = null;

    win
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) {
          collapsePanel(dispatch, sessionsRef.current);
        }
      })
      .then((u) => {
        unlisten = u;
      });

    return () => {
      unlisten?.();
    };
  }, [dispatch, panelState]);
}
