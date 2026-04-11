import type { HistorySession } from "../context/types";

interface Props {
  session: HistorySession;
  onClick: () => void;
}

function formatRelativeTime(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export default function HistoryCard({ session, onClick }: Props) {
  const projectName = session.projectPath.split("/").pop() ?? session.projectPath;
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
        <span>{projectName}</span>
        {session.gitBranch && <span>/{session.gitBranch}</span>}
        <span>{session.messageCount} msgs</span>
      </div>
    </div>
  );
}
