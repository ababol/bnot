import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect } from "react";
import type { AgentSession, HistorySession } from "../context/types";

interface SessionsUpdatedPayload {
  sessions: Record<string, AgentSession>;
  heroId: string | null;
}

export function useTauriEvents(
  dispatch: React.Dispatch<
    | {
        type: "UPDATE_SESSIONS";
        sessions: Record<string, AgentSession>;
        heroId: string | null;
      }
    | { type: "SET_PANEL_STATE"; panelState: "compact" | "overview" | "approval" | "ask" | "jump" }
    | { type: "UPDATE_HISTORY"; history: HistorySession[] }
  >,
  panelState: string,
) {
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
      const state = event.payload.state as "compact" | "overview" | "approval" | "ask" | "jump";
      dispatch({ type: "SET_PANEL_STATE", panelState: state });
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
    if (panelState === "compact" || panelState === "jump") return;

    const win = getCurrentWebviewWindow();
    let unlisten: (() => void) | null = null;

    win.onFocusChanged(({ payload: focused }) => {
      if (!focused) {
        dispatch({ type: "SET_PANEL_STATE", panelState: "compact" });
        invoke("set_panel_state", { state: "compact" });
      }
    }).then((u) => {
      unlisten = u;
    });

    return () => {
      unlisten?.();
    };
  }, [dispatch, panelState]);
}
