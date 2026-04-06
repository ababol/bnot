import type { AgentSession, SessionStatus } from "../context/types";
import { contextPercent } from "../context/types";
import type { BuddyColor } from "../lib/colors";
import PixelProgressBar from "./pixel-progress-bar";

interface Props {
  session: AgentSession;
  isHero: boolean;
  onClick: () => void;
}

const STATUS_COLORS: Record<SessionStatus, string> = {
  active: "bg-buddy-green",
  waitingApproval: "bg-buddy-orange",
  waitingAnswer: "bg-buddy-cyan",
  completed: "bg-buddy-blue",
  error: "bg-buddy-red",
};

const STATUS_TEXT_COLORS: Record<SessionStatus, string> = {
  active: "text-buddy-green",
  waitingApproval: "text-buddy-orange",
  waitingAnswer: "text-buddy-cyan",
  completed: "text-buddy-blue",
  error: "text-buddy-red",
};

const STATUS_BUDDY: Record<SessionStatus, BuddyColor> = {
  active: "blue",
  waitingApproval: "orange",
  waitingAnswer: "cyan",
  completed: "green",
  error: "orange",
};

const STATUS_TEXT: Record<SessionStatus, string> = {
  active: "Working...",
  waitingApproval: "Needs approval",
  waitingAnswer: "Asking question",
  completed: "Completed",
  error: "Error",
};

function formatDuration(startedAt: number): string {
  const elapsed = (Date.now() - startedAt) / 1000;
  if (elapsed < 60) return `${Math.floor(elapsed)}s`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m`;
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  return `${h}h${m}m`;
}

function shortenPath(p: string): string {
  const parts = p.split("/");
  return parts.length > 2 ? parts.slice(-2).join("/") : p;
}

function tokenShort(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.floor(tokens / 1_000)}K`;
  return String(tokens);
}

export default function SessionCard({ session, isHero, onClick }: Props) {
  const dirName = session.workingDirectory.split("/").pop() ?? session.workingDirectory;

  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded-lg p-2.5 transition-colors ${isHero ? "bg-surface-hover" : "bg-surface"} hover:bg-surface-hover`}
    >
      {/* Top row */}
      <div className="flex items-center gap-1.5">
        <div className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLORS[session.status]}`} />
        <div className="min-w-0 flex-1 truncate text-xs font-medium text-white">
          {session.taskName ?? dirName}
        </div>
        {(session.gitWorktree || session.gitBranch) && (
          <div className="shrink-0 truncate max-w-[100px] font-mono text-[10px] text-text-dim">
            {session.gitWorktree ? `~${session.gitWorktree}` : session.gitBranch}
          </div>
        )}
        <div className="shrink-0 font-mono text-[10px] text-text-dim">
          {formatDuration(session.startedAt)}
        </div>
      </div>

      {/* Hero details */}
      {isHero && (
        <div className="mt-1">
          {session.currentTool && session.currentTool !== "Unknown" ? (
            <div className="flex gap-1 font-mono text-[11px] text-buddy-cyan">
              <span className="font-medium">{session.currentTool}</span>
              {session.currentFilePath && (
                <span className="text-text-dim">{shortenPath(session.currentFilePath)}</span>
              )}
            </div>
          ) : (
            <div
              className={`font-mono text-[11px] opacity-80 ${STATUS_TEXT_COLORS[session.status]}`}
            >
              {STATUS_TEXT[session.status]}
            </div>
          )}

          <div
            className="mt-0.5 truncate font-mono text-[10px] text-text-dim"
            dir="rtl"
            style={{ textAlign: "left" }}
          >
            {session.workingDirectory}
          </div>

          {session.maxContextTokens > 0 && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <div className="flex-1">
                <PixelProgressBar
                  percent={contextPercent(session)}
                  color={STATUS_BUDDY[session.status]}
                />
              </div>
              <div className="shrink-0 font-mono text-[9px] font-medium text-text-dim">
                {tokenShort(session.contextTokens)}/{tokenShort(session.maxContextTokens)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
