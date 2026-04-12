import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useSession } from "../context/session-context";
import type { AgentSession } from "../context/types";
import {
  contextPercent,
  directoryName,
  isIdle,
  isWorking,
  MODE_BADGE,
  STATUS_BUDDY,
  STATUS_TEXT,
  STATUS_TEXT_COLORS,
} from "../context/types";
import { useTimer } from "../hooks/use-timer";
import type { BuddyColor } from "../lib/colors";
import { buddyTraitsFromId, parseBuddyColor, sessionStatusDot } from "../lib/colors";
import { formatElapsed, formatIdle, shortenPath, tokenShort } from "../lib/format";
import { setPanelState } from "../lib/tauri";
import DiffView, { diffStats } from "./diff-view";
import PixelBell from "./pixel-bell";
import PixelBuddy from "./pixel-buddy";
import PixelProgressBar from "./pixel-progress-bar";

interface Props {
  session: AgentSession;
  isHero: boolean;
  onClick: () => void;
}

export default function SessionCard({ session, isHero, onClick }: Props) {
  const { dispatch } = useSession();
  const now = useTimer();
  const repoName = session.gitRepoName ?? directoryName(session);
  const suffix = session.gitWorktree ?? session.gitBranch;
  const dirName = suffix ? `${repoName}/${suffix}` : repoName;
  const idle = isIdle(session, now);
  const elapsed = idle
    ? now - session.lastActivity
    : now - (session.taskStartedAt ?? session.startedAt);
  const buddyId = session.workingDirectory + (suffix ?? "");
  const traits = buddyTraitsFromId(buddyId, suffix ?? undefined);
  const buddyColor: BuddyColor = parseBuddyColor(session.agentColor) ?? traits.color;
  const working = isWorking(session, now);
  const dot = sessionStatusDot(session.status, working, session.sessionMode);
  const approval = session.pendingApproval;
  const question = session.pendingQuestion;

  const selectOption = (index: number) => {
    invoke("answer_question", { sessionId: session.id, optionIndex: index });
    setPanelState(dispatch, "compact");
  };

  const handleOptionClick = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    selectOption(index);
  };

  // Keyboard shortcuts: press 1-9 to select an option
  useEffect(() => {
    if (!question || question.options.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= question.options.length) {
        selectOption(num - 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [question]);

  const handleApprove = (e: React.MouseEvent) => {
    e.stopPropagation();
    invoke("approve_session", { sessionId: session.id });
    setPanelState(dispatch, "compact");
  };

  const handleApproveAlways = (e: React.MouseEvent) => {
    e.stopPropagation();
    invoke("approve_session_always", { sessionId: session.id });
    setPanelState(dispatch, "compact");
  };

  const handleDeny = (e: React.MouseEvent) => {
    e.stopPropagation();
    invoke("deny_session", { sessionId: session.id, feedback: null });
    setPanelState(dispatch, "compact");
  };

  const handleAcceptEdits = (e: React.MouseEvent) => {
    e.stopPropagation();
    invoke("accept_edits_session", { sessionId: session.id });
    setPanelState(dispatch, "compact");
  };

  const handleBypass = (e: React.MouseEvent) => {
    e.stopPropagation();
    invoke("bypass_permissions_session", { sessionId: session.id });
    setPanelState(dispatch, "compact");
  };

  const handleFeedbackSubmit = (text: string) => {
    invoke("deny_session", { sessionId: session.id, feedback: text });
    setPanelState(dispatch, "compact");
  };

  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded-lg p-2.5 transition-colors ${isHero ? "bg-surface-hover" : "bg-surface"} hover:bg-surface-hover`}
    >
      {/* Top row */}
      <div className="flex items-center gap-1.5">
        <PixelBuddy color={buddyColor} isActive={working} traits={traits} dot={dot} />
        <div className="min-w-0 flex-1 truncate text-xs font-medium text-white">
          {session.sessionName ?? session.taskName ?? dirName}
        </div>
        {session.sessionMode && MODE_BADGE[session.sessionMode] && (
          <span
            className={`shrink-0 rounded px-1 py-px text-[9px] font-bold ${MODE_BADGE[session.sessionMode].bg} ${MODE_BADGE[session.sessionMode].text}`}
          >
            {MODE_BADGE[session.sessionMode].label}
          </span>
        )}
        <div className="shrink-0 font-mono text-[10px] text-text-dim">
          {idle ? formatIdle(elapsed) : formatElapsed(elapsed)}
        </div>
        {(session.status === "waitingApproval" || session.status === "waitingAnswer") && (
          <PixelBell />
        )}
      </div>

      {/* ExitPlanMode UI — plan review with feedback */}
      {approval && approval.toolName === "ExitPlanMode" ? (
        <ExitPlanModeUI
          plan={approval.diffPreview ?? ""}
          onApprove={handleApprove}
          onAcceptEdits={handleAcceptEdits}
          onBypass={handleBypass}
          onFeedback={handleFeedbackSubmit}
        />
      ) : approval ? (
        <div className="mt-1.5">
          {/* Tool + file */}
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11px]">{"\u26A0"}</span>
            <span className="font-mono text-[12px] font-bold text-buddy-orange">
              {approval.toolName}
            </span>
          </div>

          {/* Diff preview or command */}
          {approval.diffPreview ? (
            <div className="mt-1.5 max-h-[160px] overflow-auto rounded-lg bg-surface">
              {(() => {
                const stats = diffStats(approval.diffPreview);
                return (
                  <div className="flex items-center gap-2 border-b border-white/5 px-2 py-1 font-mono text-[11px]">
                    <span className="font-semibold text-white/70">
                      {approval.filePath ? shortenPath(approval.filePath) : "file"}
                    </span>
                    {stats.added > 0 && <span className="text-buddy-green">+{stats.added}</span>}
                    {stats.removed > 0 && <span className="text-buddy-red">-{stats.removed}</span>}
                  </div>
                );
              })()}
              <DiffView diff={approval.diffPreview} />
            </div>
          ) : approval.input ? (
            <div className="mt-1.5 max-h-[100px] overflow-auto rounded-lg bg-surface">
              {approval.filePath && (
                <div className="border-b border-white/5 px-2 py-1 font-mono text-[10px] text-text-dim">
                  {shortenPath(approval.filePath)}
                </div>
              )}
              <div className="px-2.5 py-2 font-mono text-[11px] text-buddy-green">
                <span className="mr-1.5 text-text-dim">$</span>
                {approval.input}
              </div>
            </div>
          ) : approval.filePath ? (
            <div className="mt-1 font-mono text-[11px] text-text-dim">
              {shortenPath(approval.filePath)}
            </div>
          ) : null}

          {/* Action buttons */}
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleApprove}
              className="flex-1 cursor-pointer rounded-lg border-none bg-white/90 py-2 text-[12px] font-semibold text-black hover:bg-white"
            >
              Yes
            </button>
            {approval.canRemember && (
              <button
                onClick={handleApproveAlways}
                className="flex-1 cursor-pointer rounded-lg border-none bg-surface-active py-2 text-[11px] font-medium text-white hover:bg-white/20"
              >
                Don't ask again
              </button>
            )}
            <button
              onClick={handleDeny}
              className="flex-1 cursor-pointer rounded-lg border-none bg-surface-active py-2 text-[12px] font-medium text-white hover:bg-white/20"
            >
              No
            </button>
          </div>
        </div>
      ) : question ? (
        /* Inline question UI */
        <div className="mt-1.5">
          {/* Header */}
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-[11px]">{"\uD83D\uDCAC"}</span>
            <span className="text-[11px] font-semibold text-buddy-cyan">Claude's Question</span>
          </div>

          {/* Question header tag + text */}
          <div className="mb-2 text-[12px] text-white/90">
            {question.header && (
              <span className="mr-1.5 font-semibold text-buddy-cyan">[{question.header}]</span>
            )}
            {question.question}
          </div>

          {/* Options */}
          <div className="flex flex-col gap-1.5">
            {question.options.map((option, i) => (
              <button
                key={option}
                onClick={(e) => handleOptionClick(e, i)}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border-none bg-buddy-cyan/10 px-3 py-2.5 text-left hover:bg-buddy-cyan/20"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-buddy-cyan/30 text-[10px] font-bold text-buddy-cyan">
                  {i + 1}
                </span>
                <div className="flex-1">
                  <div className="text-[12px] font-medium text-white">{option}</div>
                  {question.optionDescriptions?.[i] && (
                    <div className="text-[10px] text-white/50">
                      {question.optionDescriptions[i]}
                    </div>
                  )}
                </div>
                <span className="text-[11px] text-white/30">{"\u203A"}</span>
              </button>
            ))}
          </div>
        </div>
      ) : isHero ? (
        /* Hero details (non-approval) */
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
        </div>
      ) : null}
    </div>
  );
}

interface ExitPlanModeUIProps {
  plan: string;
  onApprove: (e: React.MouseEvent) => void;
  onAcceptEdits: (e: React.MouseEvent) => void;
  onBypass: (e: React.MouseEvent) => void;
  onFeedback: (text: string) => void;
}

function ExitPlanModeUI({
  plan,
  onApprove,
  onAcceptEdits,
  onBypass,
  onFeedback,
}: ExitPlanModeUIProps) {
  const [feedback, setFeedback] = useState("");

  return (
    <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="mb-1.5 flex items-baseline gap-1.5">
        <span className="text-[11px]">{"\u26A0"}</span>
        <span className="font-mono text-[12px] font-bold text-buddy-orange">Plan</span>
      </div>

      {/* Plan content */}
      <div className="mb-2 max-h-[180px] overflow-auto rounded-lg bg-surface px-3 py-2">
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-white/80">
          {plan}
        </pre>
      </div>

      {/* Feedback input */}
      <input
        type="text"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && feedback.trim()) {
            onFeedback(feedback.trim());
          }
        }}
        placeholder="Tell Claude what to change..."
        className="mb-2 w-full rounded-lg border-none bg-surface px-3 py-2 text-[11px] text-white placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-buddy-cyan/50"
      />

      {/* Action buttons */}
      <div className="flex gap-1.5">
        <button
          onClick={onApprove}
          className="flex-1 cursor-pointer rounded-lg border-none bg-white/90 py-2 text-[11px] font-semibold text-black hover:bg-white"
        >
          Manually Approve
        </button>
        <button
          onClick={onAcceptEdits}
          className="flex-1 cursor-pointer rounded-lg border-none bg-buddy-orange/80 py-2 text-[11px] font-semibold text-black hover:bg-buddy-orange"
        >
          Auto-accept Edits
        </button>
        <button
          onClick={onBypass}
          className="flex-1 cursor-pointer rounded-lg border-none bg-buddy-red/80 py-2 text-[11px] font-semibold text-white hover:bg-buddy-red"
        >
          Bypass Permissions
        </button>
      </div>
    </div>
  );
}
