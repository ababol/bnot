import { useEffect, useState } from "react";
import type { AgentSession, SessionStatus } from "../context/types";
import { contextPercent } from "../context/types";
import type { BuddyColor } from "../lib/colors";
import { buddyTraitsFromId } from "../lib/colors";
import PixelBuddy from "./pixel-buddy";
import PixelProgressBar from "./pixel-progress-bar";

interface Props {
  session: AgentSession;
  isHero: boolean;
  onClick: () => void;
}

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

const MODE_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  plan: { label: "PLAN", bg: "bg-[#1a3a3a]", text: "text-[#6abfbf]" },
  auto: { label: "AUTO", bg: "bg-[#3a3520]", text: "text-[#bfaa5a]" },
  dangerous: { label: "YOLO", bg: "bg-[#3a2020]", text: "text-[#bf6a6a]" },
};

function formatElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${Math.floor(s)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  if (m < 60) return `${m}m${String(sec).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${String(rm).padStart(2, "0")}m`;
}

function formatIdle(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (rm === 0) return `${h}h ago`;
  return `${h}h${rm}m ago`;
}

function useTimer(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
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
  const now = useTimer();
  const repoName = session.gitRepoName ?? session.workingDirectory.split("/").pop() ?? session.workingDirectory;
  const suffix = session.gitWorktree ?? session.gitBranch;
  const dirName = suffix ? `${repoName}/${suffix}` : repoName;
  const isIdle = session.status === "active" && session.cpuPercent < 2.0;
  const elapsed = isIdle
    ? now - session.lastActivity
    : now - (session.taskStartedAt ?? session.startedAt);
  const buddyId = session.workingDirectory + (suffix ?? "");
  const traits = buddyTraitsFromId(buddyId, suffix ?? undefined);
  const isWorking = session.status === "active" && session.cpuPercent >= 2.0;
  const statusColor: BuddyColor = session.status === "waitingApproval" ? "orange"
    : session.status === "waitingAnswer" ? "cyan"
    : session.status === "error" ? "red"
    : isWorking ? traits.color
    : "gray";

  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded-lg p-2.5 transition-colors ${isHero ? "bg-surface-hover" : "bg-surface"} hover:bg-surface-hover`}
    >
      {/* Top row */}
      <div className="flex items-center gap-1.5">
        <PixelBuddy color={statusColor} identityColor={traits.color} isActive={isWorking} traits={traits} />
        <div className="min-w-0 flex-1 truncate text-xs font-medium text-white">
          {session.sessionName ?? session.taskName ?? dirName}
        </div>
        <div className="shrink-0 font-mono text-[10px] text-text-dim">
          {isIdle ? formatIdle(elapsed) : formatElapsed(elapsed)}
        </div>
        {session.sessionMode && MODE_BADGE[session.sessionMode] && (
          <span
            className={`shrink-0 rounded px-1 py-px text-[9px] font-bold ${MODE_BADGE[session.sessionMode].bg} ${MODE_BADGE[session.sessionMode].text}`}
          >
            {MODE_BADGE[session.sessionMode].label}
          </span>
        )}
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

          {(
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
