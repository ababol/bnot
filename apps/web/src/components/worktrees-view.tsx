import { useEffect, useRef } from "react";
import { useSession } from "../context/session-context";
import { openWorktreeAndCollapse } from "../lib/tauri";
import WorktreeCard from "./worktree-card";

export default function WorktreesView() {
  const { state, dispatch } = useSession();
  // Registry already emits sorted-by-lastActivity.
  const worktrees = state.worktrees;
  const cursor = Math.min(state.worktreesCursor, Math.max(0, worktrees.length - 1));
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    rowRefs.current[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor, worktrees.length]);

  if (worktrees.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-text-dim">
        No worktrees yet. Open a PR deep link or create one through Bnot to list it here.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-3">
      {worktrees.map((w, i) => (
        <WorktreeCard
          key={w.path}
          ref={(el) => {
            rowRefs.current[i] = el;
          }}
          worktree={w}
          isCursor={i === cursor}
          onClick={() => openWorktreeAndCollapse(dispatch, state.sessions, w.path)}
        />
      ))}
    </div>
  );
}
