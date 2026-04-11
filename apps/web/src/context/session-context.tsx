import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import type { AgentSession, HistorySession, PanelState } from "./types";

interface SessionState {
  sessions: Record<string, AgentSession>;
  heroSessionId: string | null;
  panelState: PanelState;
  history: HistorySession[];
}

export type SessionAction =
  | {
      type: "UPDATE_SESSIONS";
      sessions: Record<string, AgentSession>;
      heroId: string | null;
    }
  | { type: "SET_PANEL_STATE"; panelState: PanelState }
  | { type: "UPDATE_HISTORY"; history: HistorySession[] };

const initialState: SessionState = {
  sessions: {},
  heroSessionId: null,
  panelState: "compact",
  history: [],
};

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "UPDATE_SESSIONS":
      return {
        ...state,
        sessions: action.sessions,
        heroSessionId: action.heroId,
      };
    case "SET_PANEL_STATE":
      return { ...state, panelState: action.panelState };
    case "UPDATE_HISTORY":
      return { ...state, history: action.history };
    default:
      return action satisfies never;
  }
}

const SessionContext = createContext<{
  state: SessionState;
  dispatch: React.Dispatch<SessionAction>;
}>({ state: initialState, dispatch: () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
