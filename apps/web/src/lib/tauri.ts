import { invoke } from "@tauri-apps/api/core";
import type { AgentSession, PanelState } from "../context/types";

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
  const hasPending = Object.values(sessions).some(
    (s) => s.status === "waitingApproval" || s.status === "waitingAnswer",
  );
  setPanelState(dispatch, hasPending ? "alert" : "compact");
}

export function jumpToSession(sessionId: string): void {
  invoke("jump_to_session", { sessionId });
}
