import type { BnotColor } from "./colors";
import type { Tab } from "./tabs";

export type LaunchPhase = { kind: "idle" } | { kind: "launched" };
export type ResumePhase = { kind: "idle" } | { kind: "opened"; branch: string };
export type ApprovePhase =
  | { kind: "idle" }
  | { kind: "working"; decision: "approved" | "always" | "denied" }
  | { kind: "approved" }
  | { kind: "always" }
  | { kind: "denied" };

export type Phases = {
  launch: LaunchPhase;
  approve: ApprovePhase;
  resume: ResumePhase;
};

export type TerminalLineKind =
  | "prompt"
  | "typing"
  | "processing"
  | "tool"
  | "output"
  | "success"
  | "error"
  | "dim"
  | "banner"
  | "bootSprite"
  | "diff";

export type TerminalLine = {
  id: string;
  kind: TerminalLineKind;
  text: string;
  /** Optional agent-color override — used by banner lines tinted with the session's color. */
  color?: BnotColor;
  /** Delay (ms) before this line fades in after mount. Used to reveal the
   *  Approve-tab exploration lines progressively instead of dumping them
   *  all at once the moment the tab switches. */
  revealDelayMs?: number;
  /** For kind="diff" only: unified-diff marker + line number rendered in
   *  the gutter. `text` carries the raw line content without the marker. */
  diffMeta?: { marker: " " | "+" | "-"; num: number };
};

/** Lines appended by user interactions, keyed by session id. */
export type TerminalActions = Record<string, TerminalLine[]>;

export function initialPhases(): Phases {
  return {
    launch: { kind: "idle" },
    approve: { kind: "idle" },
    resume: { kind: "idle" },
  };
}

export type TabId = Tab["id"];
