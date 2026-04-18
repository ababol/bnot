import { invoke } from "@tauri-apps/api/core";
import type { SessionAction } from "../context/session-context";
import { needsAttention, type AgentSession, type PanelState } from "../context/types";

// Wait out the panel collapse animation (ANIMATION_DURATION in apps/desktop/src/window.rs)
// before triggering the next action, so focus handoff doesn't race the shrink.
export const COLLAPSE_SETTLE_MS = 80;

export function setPanelState(
  dispatch: React.Dispatch<{ type: "SET_PANEL_STATE"; panelState: PanelState }>,
  panelState: PanelState,
): void {
  dispatch({ type: "SET_PANEL_STATE", panelState });
  invoke("set_panel_state", { state: panelState });
}

/** Collapse the panel to either `compact` or `alert` in one step — picking `alert`
 *  when any session still needs attention. Going through `compact` first would
 *  animate the window shrinking, then bouncing back out to alert width. */
export function collapsePanel(
  dispatch: React.Dispatch<{ type: "SET_PANEL_STATE"; panelState: PanelState }>,
  sessions: Record<string, AgentSession>,
): void {
  const hasPending = Object.values(sessions).some(needsAttention);
  setPanelState(dispatch, hasPending ? "alert" : "compact");
}

export function jumpToSession(sessionId: string): void {
  invoke("jump_to_session", { sessionId });
}

/** Collapse the panel then jump to an existing terminal tab. */
export function jumpToSessionAndCollapse(
  dispatch: React.Dispatch<SessionAction>,
  sessions: Record<string, AgentSession>,
  sessionId: string,
): void {
  collapsePanel(dispatch, sessions);
  setTimeout(() => jumpToSession(sessionId), COLLAPSE_SETTLE_MS);
}

/** Open a worktree in a terminal — jump if a session is already running there,
 *  otherwise spawn a fresh claude. Also returns the UI to the Sessions tab so
 *  the next panel open lands where the new session will appear. */
export function openWorktreeAndCollapse(
  dispatch: React.Dispatch<SessionAction>,
  sessions: Record<string, AgentSession>,
  worktreePath: string,
): void {
  dispatch({ type: "SET_VIEW", view: "sessions" });
  collapsePanel(dispatch, sessions);
  setTimeout(() => {
    void invoke("open_worktree_path", { path: worktreePath });
  }, COLLAPSE_SETTLE_MS);
}
