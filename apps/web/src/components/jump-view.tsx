import { invoke } from "@tauri-apps/api/core";
import { useSession } from "../context/session-context";

interface Props {
  notchHeight: number;
}

export default function JumpView({ notchHeight }: Props) {
  const { state, dispatch } = useSession();
  const heroSession = state.heroSessionId ? state.sessions[state.heroSessionId] : undefined;

  const dirName = heroSession?.workingDirectory.split("/").pop() ?? "Task";

  const jump = () => {
    if (heroSession) invoke("jump_to_session", { sessionId: heroSession.id });
    dispatch({ type: "SET_PANEL_STATE", panelState: "compact" });
    invoke("set_panel_state", { state: "compact" });
  };

  return (
    <div
      onClick={jump}
      className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-[10px] bg-black px-3"
    >
      <div className="shrink-0" style={{ height: notchHeight / 2 }} />

      <span className="text-[32px] text-buddy-green">&#x2713;</span>

      <div className="text-center">
        <div className="text-base font-bold text-white">Done</div>
        <div className="mt-1 font-mono text-xs text-text-dim">
          {heroSession?.taskName ?? dirName}
        </div>
      </div>

      <button
        onClick={jump}
        className="flex w-4/5 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border-none bg-buddy-blue/30 py-2.5 text-[13px] font-medium text-white hover:bg-buddy-blue/40"
      >
        {"\u2197"} Jump to terminal
      </button>
    </div>
  );
}
