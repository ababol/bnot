import { invoke } from "@tauri-apps/api/core";
import { useSession } from "../context/session-context";
import { setPanelState } from "../lib/tauri";
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

  const close = () => setPanelState(dispatch, "compact");

  const approve = () => {
    if (session) invoke("approve_session", { sessionId: session.id });
    close();
  };

  const approveAlways = () => {
    if (session) invoke("approve_session_always", { sessionId: session.id });
    close();
  };

  const deny = () => {
    if (session) invoke("deny_session", { sessionId: session.id });
    close();
  };

  if (!session || !approval) {
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
        <div className="max-h-[120px] overflow-auto rounded-lg bg-surface">
          <DiffView diff={approval.diffPreview} />
        </div>
      ) : approval.input ? (
        <div className="max-h-[80px] overflow-hidden rounded-lg bg-surface p-2.5 font-mono text-[11px] text-buddy-green">
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

      {/* Action buttons — matches Claude Code's permission options */}
      <div className="flex flex-col gap-1.5">
        <button
          onClick={approve}
          className="flex w-full cursor-pointer items-center gap-2 rounded-[10px] border-none bg-white/90 px-3 py-2.5 text-left text-[13px] font-semibold text-black hover:bg-white"
        >
          <span className="w-5 shrink-0 font-mono text-[11px] font-bold text-black/40">1.</span>
          Yes
        </button>
        {approval.canRemember && (
          <button
            onClick={approveAlways}
            className="flex w-full cursor-pointer items-center gap-2 rounded-[10px] border-none bg-surface-hover px-3 py-2.5 text-left text-[13px] font-medium text-white hover:bg-surface-active"
          >
            <span className="w-5 shrink-0 font-mono text-[11px] font-bold text-text-dim">2.</span>
            Yes, and don't ask again
          </button>
        )}
        <button
          onClick={deny}
          className="flex w-full cursor-pointer items-center gap-2 rounded-[10px] border-none bg-surface-hover px-3 py-2.5 text-left text-[13px] font-medium text-white hover:bg-surface-active"
        >
          <span className="w-5 shrink-0 font-mono text-[11px] font-bold text-text-dim">
            {approval.canRemember ? "3." : "2."}
          </span>
          No
        </button>
      </div>
    </div>
  );
}
