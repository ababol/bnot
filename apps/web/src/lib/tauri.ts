import { invoke } from "@tauri-apps/api/core";
import type { PanelState } from "../context/types";

export function setPanelState(
  dispatch: React.Dispatch<{ type: "SET_PANEL_STATE"; panelState: PanelState }>,
  panelState: PanelState,
): void {
  dispatch({ type: "SET_PANEL_STATE", panelState });
  invoke("set_panel_state", { state: panelState });
}

export function jumpToSession(sessionId: string): void {
  invoke("jump_to_session", { sessionId });
}
