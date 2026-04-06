import { createContext, useContext, useReducer, type ReactNode } from "react";
import type { AgentSession, PanelState } from "./types";

interface SessionState {
  sessions: Record<string, AgentSession>;
  heroSessionId: string | null;
  panelState: PanelState;
}

type SessionAction =
  | {
      type: "UPDATE_SESSIONS";
      sessions: Record<string, AgentSession>;
      heroId: string | null;
    }
  | { type: "SET_PANEL_STATE"; panelState: PanelState };

const initialState: SessionState = {
  sessions: {},
  heroSessionId: null,
  panelState: "compact",
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
  }
}

const SessionContext = createContext<{
  state: SessionState;
  dispatch: React.Dispatch<SessionAction>;
}>({ state: initialState, dispatch: () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);
  return <SessionContext.Provider value={{ state, dispatch }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
