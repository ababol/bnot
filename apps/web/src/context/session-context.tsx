import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import type {
  AgentSession,
  HookHealthReport,
  PanelState,
  UsageSnapshot,
  ViewMode,
  WorktreeRecord,
} from "./types";

interface SessionState {
  sessions: Record<string, AgentSession>;
  heroSessionId: string | null;
  panelState: PanelState;
  worktrees: WorktreeRecord[];
  view: ViewMode;
  sessionsCursor: number;
  worktreesCursor: number;
  hookHealth: HookHealthReport | null;
  usageStats: UsageSnapshot | null;
}

export type SessionAction =
  | {
      type: "UPDATE_SESSIONS";
      sessions: Record<string, AgentSession>;
      heroId: string | null;
    }
  | { type: "SET_PANEL_STATE"; panelState: PanelState }
  | { type: "UPDATE_WORKTREES"; worktrees: WorktreeRecord[] }
  | { type: "SET_VIEW"; view: ViewMode }
  | { type: "SET_SESSIONS_CURSOR"; cursor: number }
  | { type: "SET_WORKTREES_CURSOR"; cursor: number }
  | { type: "SET_HOOK_HEALTH"; hookHealth: HookHealthReport }
  | { type: "SET_USAGE_STATS"; usageStats: UsageSnapshot };

const initialState: SessionState = {
  sessions: {},
  heroSessionId: null,
  panelState: "compact",
  worktrees: [],
  view: "sessions",
  sessionsCursor: 0,
  worktreesCursor: 0,
  hookHealth: null,
  usageStats: null,
};

function clampCursor(cursor: number, length: number): number {
  if (length <= 0) return 0;
  if (cursor < 0) return 0;
  if (cursor >= length) return length - 1;
  return cursor;
}

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "UPDATE_SESSIONS":
      return {
        ...state,
        sessions: action.sessions,
        heroSessionId: action.heroId,
        sessionsCursor: clampCursor(state.sessionsCursor, Object.keys(action.sessions).length),
      };
    case "SET_PANEL_STATE":
      return { ...state, panelState: action.panelState };
    case "UPDATE_WORKTREES":
      return {
        ...state,
        worktrees: action.worktrees,
        worktreesCursor: clampCursor(state.worktreesCursor, action.worktrees.length),
      };
    case "SET_VIEW":
      return { ...state, view: action.view };
    case "SET_SESSIONS_CURSOR":
      return {
        ...state,
        sessionsCursor: clampCursor(action.cursor, Object.keys(state.sessions).length),
      };
    case "SET_WORKTREES_CURSOR":
      return {
        ...state,
        worktreesCursor: clampCursor(action.cursor, state.worktrees.length),
      };
    case "SET_HOOK_HEALTH":
      return { ...state, hookHealth: action.hookHealth };
    case "SET_USAGE_STATS":
      return { ...state, usageStats: action.usageStats };
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
