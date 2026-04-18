import { forwardRef } from "react";
import type { WorktreeRecord } from "../context/types";
import { formatRelativeTime, shortenPath } from "../lib/format";

interface Props {
  worktree: WorktreeRecord;
  isCursor: boolean;
  onClick: () => void;
}

const WorktreeCard = forwardRef<HTMLDivElement, Props>(({ worktree, isCursor, onClick }, ref) => {
  const isActive = Boolean(worktree.activeSessionId);
  const relative = formatRelativeTime(worktree.lastActivity);
  const pathHint = shortenPath(worktree.path);

  return (
    <div
      ref={ref}
      onClick={onClick}
      className={`cursor-pointer rounded-lg p-2.5 transition-colors ${
        isCursor ? "bg-surface-active ring-1 ring-white/20" : "bg-surface hover:bg-surface-hover"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            isActive ? "bg-bnot-green" : "bg-white/25"
          }`}
        />
        <div className="min-w-0 flex-1 truncate text-xs font-medium text-white">
          {worktree.branch}
        </div>
        {isActive && (
          <span className="shrink-0 rounded bg-bnot-green/20 px-1 py-px text-[9px] font-bold text-bnot-green">
            ACTIVE
          </span>
        )}
        <div className="shrink-0 font-mono text-[10px] text-text-dim">{relative}</div>
      </div>
      <div className="mt-0.5 flex gap-2 text-[10px] text-text-dim">
        <span className="truncate">{worktree.repoName}</span>
        <span
          className="ml-auto truncate font-mono text-text-dim"
          dir="rtl"
          style={{ textAlign: "left" }}
        >
          {pathHint}
        </span>
      </div>
    </div>
  );
});

WorktreeCard.displayName = "WorktreeCard";

export default WorktreeCard;
