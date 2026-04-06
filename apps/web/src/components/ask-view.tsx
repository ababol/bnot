import { invoke } from "@tauri-apps/api/core";
import { useSession } from "../context/session-context";

interface Props {
  notchHeight: number;
}

export default function AskView({ notchHeight }: Props) {
  const { state, dispatch } = useSession();

  const session = Object.values(state.sessions).find(
    (s) => s.status === "waitingAnswer" && s.pendingQuestion,
  );
  const question = session?.pendingQuestion;

  const close = () => {
    dispatch({ type: "SET_PANEL_STATE", panelState: "compact" });
    invoke("set_panel_state", { state: "compact" });
  };

  if (!session || !question) {
    close();
    return null;
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-[10px] bg-black px-3 pb-3">
      <div className="shrink-0" style={{ height: notchHeight }} />

      {/* Header */}
      <div className="mb-2.5 flex items-center gap-1.5">
        <span className="text-xs text-buddy-cyan">{"\u{1F4AC}"}</span>
        <span className="text-[13px] font-semibold text-white">Claude asks</span>
      </div>

      {/* Question */}
      <div className="mb-3 text-[13px] text-white/90">{question.question}</div>

      {/* Options */}
      {question.options.map((option, i) => (
        <button
          key={i}
          onClick={close}
          className="mb-1.5 flex w-full cursor-pointer items-center gap-2 rounded-lg border-none bg-surface px-2.5 py-2 text-left text-xs text-white hover:bg-surface-hover"
        >
          <span className="w-7 shrink-0 font-mono text-[10px] font-bold text-buddy-cyan/60">
            {"\u2318"}
            {i + 1}
          </span>
          {option}
        </button>
      ))}

      <div className="flex-1" />
    </div>
  );
}
