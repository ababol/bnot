import type { HistorySession } from "../context/types";
import { projectName } from "../context/types";
import { formatRelativeTime } from "../lib/format";

interface Props {
  session: HistorySession;
  onClick: () => void;
}

export default function HistoryCard({ session, onClick }: Props) {
  const name = projectName(session);
  const timeAgo = formatRelativeTime(session.modified);
  const label = session.summary || session.firstPrompt;

  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-lg p-2 transition-colors bg-surface hover:bg-surface-hover"
    >
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[10px] text-text-dim">&#x21bb;</span>
        <div className="min-w-0 flex-1 truncate text-xs text-text-muted">{label}</div>
        <div className="shrink-0 font-mono text-[10px] text-text-dim">{timeAgo}</div>
      </div>
      <div className="mt-0.5 flex gap-2 text-[10px] text-text-dim">
        <span>{name}</span>
        {session.gitBranch && <span>/{session.gitBranch}</span>}
        <span>{session.messageCount} msgs</span>
      </div>
    </div>
  );
}
