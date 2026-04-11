import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect } from "react";
import type { SessionAction } from "../context/session-context";
import type { AgentSession, HistorySession, PanelState } from "../context/types";
import { setPanelState } from "../lib/tauri";

interface SessionsUpdatedPayload {
  sessions: Record<string, AgentSession>;
  heroId: string | null;
}

const VALID_PANEL_STATES: Set<string> = new Set(["compact", "overview", "approval", "ask", "jump"]);

export function useTauriEvents(dispatch: React.Dispatch<SessionAction>, panelState: string) {
  useEffect(() => {
    const unlisten: Array<() => void> = [];

    listen<SessionsUpdatedPayload>("sessionsUpdated", (event) => {
      dispatch({
        type: "UPDATE_SESSIONS",
        sessions: event.payload.sessions,
        heroId: event.payload.heroId,
      });
    }).then((u) => unlisten.push(u));

    listen<{ state: string }>("panelStateChange", (event) => {
      const raw = event.payload.state;
      if (typeof raw !== "string" || !VALID_PANEL_STATES.has(raw)) return;
      setPanelState(dispatch, raw as PanelState);
    }).then((u) => unlisten.push(u));

    listen<{ history: HistorySession[] }>("historyUpdated", (event) => {
      dispatch({ type: "UPDATE_HISTORY", history: event.payload.history });
    }).then((u) => unlisten.push(u));

    return () => {
      unlisten.forEach((u) => u());
    };
  }, [dispatch]);

  // Collapse panel when window loses focus (user clicks outside)
  useEffect(() => {
    if (
      panelState === "compact" ||
      panelState === "jump" ||
      panelState === "approval" ||
      panelState === "ask"
    )
      return;

    const win = getCurrentWebviewWindow();
    let unlisten: (() => void) | null = null;

    win
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) {
          setPanelState(dispatch, "compact");
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
