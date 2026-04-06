import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import type { AgentSession } from "../context/types";

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
  >,
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

    return () => {
      unlisten.forEach((u) => u());
    };
  }, [dispatch]);
}
