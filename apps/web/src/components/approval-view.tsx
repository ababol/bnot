import { invoke } from "@tauri-apps/api/core";
import { useSession } from "../context/session-context";
import DiffView from "./diff-view";

interface Props {
  notchHeight: number;
}

export default function ApprovalView({ notchHeight }: Props) {
  const { state, dispatch } = useSession();

  const session = Object.values(state.sessions).find(
    (s) => s.status === "waitingApproval" && s.pendingApproval,
  );
  const approval = session?.pendingApproval;

  const close = () => {
    dispatch({ type: "SET_PANEL_STATE", panelState: "compact" });
    invoke("set_panel_state", { state: "compact" });
  };

  const approve = () => {
    if (session) invoke("jump_to_session", { sessionId: session.id });
    close();
  };

  if (!session || !approval) {
    close();
    return null;
  }

  const diffStats = (diff: string) => {
    let added = 0,
      removed = 0;
    for (const line of diff.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) added++;
      if (line.startsWith("-") && !line.startsWith("---")) removed++;
    }
    return { added, removed };
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-[10px] bg-black px-3 pb-3">
      <div className="shrink-0" style={{ height: notchHeight }} />

      {/* Header */}
      <div className="mb-2.5 flex items-center gap-1.5">
        <div className="h-2 w-2 rounded-full bg-buddy-orange" />
        <span className="text-[13px] font-medium text-text-muted">Permission Request</span>
      </div>

      {/* Tool + file path */}
      <div className="mb-2.5 flex items-baseline gap-1.5">
        <span className="text-sm">{"\u26A0"}</span>
        <span className="font-mono text-[15px] font-bold text-buddy-orange">
          {approval.toolName}
        </span>
        {approval.filePath && (
          <span
            className="truncate font-mono text-xs text-text-muted"
            dir="rtl"
            style={{ textAlign: "left" }}
          >
            {approval.filePath}
          </span>
        )}
      </div>

      {/* Diff preview or command */}
      {approval.diffPreview ? (
        <div className="max-h-[200px] flex-1 overflow-auto rounded-lg bg-surface">
          <DiffView diff={approval.diffPreview} />
        </div>
      ) : approval.input ? (
        <div className="max-h-[120px] flex-1 overflow-auto rounded-lg bg-surface p-2.5 font-mono text-[11px] text-buddy-green">
          {approval.input}
        </div>
      ) : null}

      <div className="min-h-1 flex-1" />

      {/* Diff stats */}
      {approval.diffPreview &&
        (() => {
          const { added, removed } = diffStats(approval.diffPreview);
          return added > 0 || removed > 0 ? (
            <div className="mb-2 font-mono text-[11px] text-text-dim">
              +{added} -{removed}
            </div>
          ) : null;
        })()}

      {/* Action buttons */}
      <div className="flex gap-2.5">
        <button
          onClick={close}
          className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border-none bg-surface-hover py-2.5 text-[13px] font-medium text-white hover:bg-surface-active"
        >
          Deny <span className="font-mono text-[11px] text-text-dim">{"\u2318"}N</span>
        </button>
        <button
          onClick={approve}
          className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border-none bg-white/90 py-2.5 text-[13px] font-semibold text-black hover:bg-white"
        >
          Allow <span className="font-mono text-[11px] text-black/50">{"\u2318"}Y</span>
        </button>
      </div>
    </div>
  );
}
