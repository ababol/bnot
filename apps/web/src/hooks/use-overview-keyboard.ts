import { useEffect } from "react";
import { useSession } from "../context/session-context";
import type { AgentSession } from "../context/types";
import { needsAttention } from "../context/types";
import { collapsePanel, jumpToSessionAndCollapse, openWorktreeAndCollapse } from "../lib/tauri";

function shouldIgnoreEvent(e: KeyboardEvent, sessions: Record<string, AgentSession>): boolean {
  // Approval / question flows own keyboard input while they're on-screen —
  // session-card listens for number keys and the approval UI has text inputs.
  for (const s of Object.values(sessions)) {
    if (needsAttention(s)) return true;
  }
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useOverviewKeyboard(sortedSessionIds: string[]) {
  const { state, dispatch } = useSession();

  useEffect(() => {
    if (state.panelState !== "overview") return;

    const handler = (e: KeyboardEvent) => {
      if (shouldIgnoreEvent(e, state.sessions)) return;

      const isSessions = state.view === "sessions";
      const list = isSessions ? sortedSessionIds : state.worktrees.map((w) => w.path);
      const cursor = isSessions ? state.sessionsCursor : state.worktreesCursor;
      const cursorAction = isSessions ? "SET_SESSIONS_CURSOR" : "SET_WORKTREES_CURSOR";

      switch (e.key) {
        case "ArrowLeft": {
          e.preventDefault();
          dispatch({ type: "SET_VIEW", view: "sessions" });
          return;
        }
        case "ArrowRight": {
          e.preventDefault();
          dispatch({ type: "SET_VIEW", view: "worktrees" });
          return;
        }
        case "ArrowUp": {
          if (list.length === 0) return;
          e.preventDefault();
          const next = cursor <= 0 ? list.length - 1 : cursor - 1;
          dispatch({ type: cursorAction, cursor: next });
          return;
        }
        case "ArrowDown": {
          if (list.length === 0) return;
          e.preventDefault();
          const next = cursor >= list.length - 1 ? 0 : cursor + 1;
          dispatch({ type: cursorAction, cursor: next });
          return;
        }
        case "Enter": {
          if (list.length === 0) return;
          e.preventDefault();
          if (isSessions) {
            const id = sortedSessionIds[cursor];
            if (id) jumpToSessionAndCollapse(dispatch, state.sessions, id);
          } else {
            const worktree = state.worktrees[cursor];
            if (worktree) openWorktreeAndCollapse(dispatch, state.sessions, worktree.path);
          }
          return;
        }
        case "Escape": {
          e.preventDefault();
          collapsePanel(dispatch, state.sessions);
          return;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    state.panelState,
    state.view,
    state.sessionsCursor,
    state.worktreesCursor,
    state.sessions,
    state.worktrees,
    sortedSessionIds,
    dispatch,
  ]);
}
