import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useSession } from "../context/session-context";
import type { AgentSession, QuestionItem } from "../context/types";
import {
  contextPercent,
  directoryName,
  isIdle,
  isWorking,
  MODE_BADGE,
  needsAttention,
  STATUS_BNOT,
  STATUS_TEXT,
  STATUS_TEXT_COLORS,
} from "../context/types";
import { useTimer } from "../hooks/use-timer";
import type { BnotColor } from "../lib/colors";
import { bnotTraitsFromId, parseBnotColor, sessionStatusDot } from "../lib/colors";
import { formatElapsed, formatIdle, shortenPath, tokenShort } from "../lib/format";
import { collapsePanel } from "../lib/tauri";
import DiffView, { diffStats } from "./diff-view";
import PixelBell from "./pixel-bell";
import PixelBnot from "./pixel-bnot";
import PixelProgressBar from "./pixel-progress-bar";
import StatusIndicator from "./status-indicator";

interface Props {
  session: AgentSession;
  isHero: boolean;
  onClick: () => void;
}

export default function SessionCard({ session, isHero, onClick }: Props) {
  const { state, dispatch } = useSession();
  // Collapse based on the sessions that remain after this one is resolved, so
  // we go straight to the right target (alert if others still need attention,
  // compact otherwise) rather than bouncing through compact first.
  const collapseAfterAction = () => {
    const { [session.id]: _resolved, ...rest } = state.sessions;
    collapsePanel(dispatch, rest);
  };
  const now = useTimer();
  const repoName = session.gitRepoName ?? directoryName(session);
  const suffix = session.gitWorktree ?? session.gitBranch;
  const dirName = suffix ? `${repoName}/${suffix}` : repoName;
  const idle = isIdle(session, now);
  const elapsed = idle
    ? now - session.lastActivity
    : now - (session.taskStartedAt ?? session.startedAt);
  const bnotId = session.workingDirectory + (suffix ?? "");
  const traits = bnotTraitsFromId(bnotId, suffix ?? undefined);
  const bnotColor: BnotColor = parseBnotColor(session.agentColor) ?? "gray";
  const working = isWorking(session, now);
  const dot = sessionStatusDot(session.status, working, session.sessionMode);
  const approval = session.pendingApproval;
  const question = session.pendingQuestion;

  // Multi-select / multi-question answer state.
  // Keys are question indices (0-based); values are sets of selected option indices.
  const [selectedMap, setSelectedMap] = useState<Record<number, Set<number>>>({});
  // Step-by-step: which question we're currently showing (for multi-question flows).
  const [currentQIdx, setCurrentQIdx] = useState(0);
  // Reset selection only when a genuinely NEW question arrives (different receivedAt).
  // Do NOT compare by object reference — sessionsUpdated recreates objects on every
  // heartbeat, which would wipe the user's in-progress selection on each re-render.
  const prevQuestionKeyRef = useRef<number | undefined>(undefined);
  const questionKey = question?.receivedAt;
  if (prevQuestionKeyRef.current !== questionKey) {
    prevQuestionKeyRef.current = questionKey;
    if (Object.keys(selectedMap).length > 0) setSelectedMap({});
    if (currentQIdx !== 0) setCurrentQIdx(0);
  }

  const allQs: QuestionItem[] = question
    ? question.allQuestions ?? [question]
    : [];

  const isSingleSelectSingle = allQs.length === 1 && !allQs[0]?.multiSelect;
  const currentQ = allQs[currentQIdx];
  const isLastQuestion = currentQIdx === allQs.length - 1;

  const runAction = (cmd: string, extra?: Record<string, unknown>) => {
    invoke(cmd, { sessionId: session.id, ...extra });
    collapseAfterAction();
  };
  const runActionOnClick =
    (cmd: string, extra?: Record<string, unknown>) => (e: React.MouseEvent) => {
      e.stopPropagation();
      runAction(cmd, extra);
    };

  /** Build the answers dict from current selection and invoke answer_question. */
  const submitAnswers = (overrideMap?: Record<number, Set<number>>) => {
    const map = overrideMap ?? selectedMap;
    const answers: Record<string, string | string[]> = {};
    allQs.forEach((q, qi) => {
      const sel = map[qi];
      if (!sel || sel.size === 0) return;
      const labels = [...sel].map((i) => q.options[i]).filter(Boolean) as string[];
      answers[q.question] = q.multiSelect ? labels : (labels[0] ?? "");
    });
    runAction("answer_question", { answers });
  };

  /**
   * Single-click handler for single-select questions.
   * - Single-question: submit immediately.
   * - Multi-question: store and auto-advance to next question (submit on last).
   */
  const handleSingleSelect = (qi: number, optIdx: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    const newMap = { ...selectedMap, [qi]: new Set([optIdx]) };
    setSelectedMap(newMap);
    if (isSingleSelectSingle) {
      // Single question single-select → immediate submit
      submitAnswers(newMap);
    } else if (!isLastQuestion) {
      // Multi-question: advance to next step
      setCurrentQIdx(qi + 1);
    } else {
      // Last question: submit all accumulated answers
      submitAnswers(newMap);
    }
  };

  /** Toggle handler for multi-select checkboxes (doesn't submit immediately). */
  const handleToggle = (qi: number, optIdx: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedMap((prev) => {
      const set = new Set(prev[qi] ?? []);
      if (set.has(optIdx)) set.delete(optIdx);
      else set.add(optIdx);
      return { ...prev, [qi]: set };
    });
  };

  /** Advance to next question or submit if on the last one. */
  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isLastQuestion) {
      setCurrentQIdx(currentQIdx + 1);
    } else {
      submitAnswers();
    }
  };

  /** Current question has ≥1 selection (enables Next/Submit button for multi-select). */
  const currentAnswered = (selectedMap[currentQIdx]?.size ?? 0) > 0;

  // Keyboard shortcut: 1-9 picks option for single-question single-select only.
  useEffect(() => {
    if (!question || !isSingleSelectSingle || !currentQ || currentQ.options.length === 0) return;
    const opts = currentQ.options;
    const handler = (e: KeyboardEvent) => {
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= opts.length) {
        const map = { 0: new Set([num - 1]) };
        submitAnswers(map);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [question, isSingleSelectSingle, currentQ]);

  const handleApprove = runActionOnClick("approve_session");
  const handleApproveAlways = runActionOnClick("approve_session_always");
  const handleDeny = runActionOnClick("deny_session", { feedback: null });
  const handleAcceptEdits = runActionOnClick("accept_edits_session");
  const handleBypass = runActionOnClick("bypass_permissions_session");
  const handleFeedbackSubmit = (text: string) => runAction("deny_session", { feedback: text });

  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded-lg p-2.5 transition-colors ${isHero ? "bg-surface-hover" : "bg-surface"} hover:bg-surface-hover`}
    >
      {/* Top row */}
      <div className="flex items-center gap-1.5">
        <PixelBnot color={bnotColor} isActive={working} traits={traits} />
        <StatusIndicator dot={dot} size="sm" />
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
        {needsAttention(session) && <PixelBell />}
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
            <span className="font-mono text-[12px] font-bold text-bnot-orange">
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
                    {stats.added > 0 && <span className="text-bnot-green">+{stats.added}</span>}
                    {stats.removed > 0 && <span className="text-bnot-red">-{stats.removed}</span>}
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
              <div className="px-2.5 py-2 font-mono text-[11px] text-bnot-green">
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
        /* Inline question UI — step-by-step for multi-question, single/multi-select */
        <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
          {/* Header with step indicator */}
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-[11px]">{"\uD83D\uDCAC"}</span>
            <span className="text-[11px] font-semibold text-bnot-cyan">Claude's Question</span>
            {allQs.length > 1 && (
              <span className="ml-auto text-[10px] text-white/40">
                {currentQIdx + 1}/{allQs.length}
              </span>
            )}
          </div>

          {currentQ && (
            <div>
              {/* Question text */}
              <div className="mb-2 text-[12px] text-white/90">
                {currentQ.header && (
                  <span className="mr-1.5 font-semibold text-bnot-cyan">[{currentQ.header}]</span>
                )}
                {currentQ.question}
                {currentQ.multiSelect && (
                  <span className="ml-1.5 text-[10px] text-white/40">select all that apply</span>
                )}
              </div>

              {/* Options */}
              <div className="flex flex-col gap-1.5">
                {(() => {
                  const selected = selectedMap[currentQIdx];
                  return currentQ.options.map((option, i) => {
                  const isSelected = selected?.has(i) ?? false;
                  if (currentQ.multiSelect) {
                    return (
                      <button
                        key={option}
                        onClick={handleToggle(currentQIdx, i)}
                        className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg border-none px-3 py-2.5 text-left transition-colors ${
                          isSelected
                            ? "bg-bnot-cyan/25 hover:bg-bnot-cyan/30"
                            : "bg-bnot-cyan/10 hover:bg-bnot-cyan/20"
                        }`}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] transition-colors ${
                            isSelected
                              ? "border-bnot-cyan bg-bnot-cyan text-black"
                              : "border-bnot-cyan/40 bg-transparent text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                        <div className="flex-1">
                          <div className="text-[12px] font-medium text-white">{option}</div>
                          {currentQ.optionDescriptions?.[i] && (
                            <div className="text-[10px] text-white/50">
                              {currentQ.optionDescriptions[i]}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  }
                  return (
                    <button
                      key={option}
                      onClick={handleSingleSelect(currentQIdx, i)}
                      className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border-none bg-bnot-cyan/10 px-3 py-2.5 text-left hover:bg-bnot-cyan/20"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-bnot-cyan/30 text-[10px] font-bold text-bnot-cyan">
                        {isSingleSelectSingle ? i + 1 : "›"}
                      </span>
                      <div className="flex-1">
                        <div className="text-[12px] font-medium text-white">{option}</div>
                        {currentQ.optionDescriptions?.[i] && (
                          <div className="text-[10px] text-white/50">
                            {currentQ.optionDescriptions[i]}
                          </div>
                        )}
                      </div>
                      <span className="text-[11px] text-white/30">{"\u203A"}</span>
                    </button>
                  );
                });
                })()}
              </div>

              {/* Next/Submit button — shown for multi-select steps */}
              {currentQ.multiSelect && (
                <button
                  onClick={handleNext}
                  disabled={!currentAnswered}
                  className="mt-3 w-full cursor-pointer rounded-lg border-none bg-white py-2 text-[12px] font-semibold text-black transition-opacity hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {isLastQuestion ? "Submit" : "Next"}
                </button>
              )}
            </div>
          )}
        </div>
      ) : isHero ? (
        /* Hero details (non-approval) */
        <div className="mt-1">
          {session.currentTool && session.currentTool !== "Unknown" ? (
            <div className="flex gap-1 font-mono text-[11px] text-bnot-cyan">
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
                color={STATUS_BNOT[session.status]}
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
        <span className="font-mono text-[12px] font-bold text-bnot-orange">Plan</span>
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
        className="mb-2 w-full rounded-lg border-none bg-surface px-3 py-2 text-[11px] text-white placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-bnot-cyan/50"
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
          className="flex-1 cursor-pointer rounded-lg border-none bg-bnot-orange/80 py-2 text-[11px] font-semibold text-black hover:bg-bnot-orange"
        >
          Auto-accept Edits
        </button>
        <button
          onClick={onBypass}
          className="flex-1 cursor-pointer rounded-lg border-none bg-bnot-red/80 py-2 text-[11px] font-semibold text-white hover:bg-bnot-red"
        >
          Bypass Permissions
        </button>
      </div>
    </div>
  );
}
