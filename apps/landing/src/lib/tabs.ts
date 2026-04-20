import { GitBranch, Github, type LucideIcon, ShieldCheck } from "lucide-react";
import type { BnotColor } from "./colors";

export type SessionStatus = "active" | "waitingApproval" | "waitingAnswer" | "idle" | "completed";

export type SessionMode = "normal" | "plan" | "auto" | "dangerous";

export type Approval = {
  tool: string;
  filePath?: string;
  input?: string;
  diff?: { added: number; removed: number };
  /** Unified-diff hunk shown in the approval panel. First line should be the
   *  `@@ -start,len +start,len @@` header; subsequent lines are ` `/`+`/`-`. */
  diffText?: string;
};

export type Session = {
  id: string;
  name: string;
  branch: string;
  repoName: string;
  workingDirectory: string;
  agentColor: BnotColor;
  status: SessionStatus;
  sessionMode?: SessionMode;
  contextTokens: number;
  maxContextTokens: number;
  elapsed: string;
  currentTool?: string;
  currentFilePath?: string;
  approval?: Approval;
};

export type Worktree = {
  branch: string;
  repoName: string;
  path: string;
  isActive: boolean;
  agentColor: BnotColor;
  lastActivity: string;
};

export type LaunchIntent = {
  issueNumber: string;
  branch: string;
  repoName: string;
};

export type PanelView =
  | {
      mode: "launch";
      intent: LaunchIntent;
      existing: Session[];
      newcomer: Session;
    }
  | { mode: "resume"; worktrees: Worktree[]; cursor: number }
  | { mode: "approve"; hero: Session; others: Session[] };

export type NotchState = {
  contextPercent: number;
};

export type Tab = {
  id: "launch" | "approve" | "resume";
  label: string;
  icon: LucideIcon;
  notch: NotchState;
  panel: PanelView;
};

const CHECKOUT_DIR = "/Users/ababol/Code/acme-web-fix-checkout-redirect";
const BILLING_DIR = "/Users/ababol/Code/acme-web-feat-billing-webhooks";

const BILLING_WEBHOOKS: Session = {
  id: "billing-webhooks",
  name: "Wire Stripe webhook handler",
  branch: "feat/billing-webhooks",
  repoName: "acme-web",
  workingDirectory: BILLING_DIR,
  agentColor: "cyan",
  // Idle — Stripe webhook work is parked in the background. Keeping it
  // active would pull attention away from the checkout-redirect narrative
  // (two working dots competing for the eye).
  status: "idle",
  contextTokens: 112_000,
  maxContextTokens: 200_000,
  elapsed: "14m 02s",
};

const CHECKOUT_LAUNCHING: Session = {
  id: "checkout-redirect",
  name: "Fix checkout redirect loop",
  branch: "fix/checkout-redirect",
  repoName: "acme-web",
  workingDirectory: CHECKOUT_DIR,
  agentColor: "green",
  status: "active",
  contextTokens: 14_000,
  maxContextTokens: 200_000,
  elapsed: "0m 04s",
  currentTool: "Read",
  currentFilePath: `${CHECKOUT_DIR}/app/checkout/page.tsx`,
};

/** Shared approval used by Approve + Resume transcripts. Exported so the
 *  terminal can render the same diff inline that the notch shows in its
 *  approval card — no risk of the two views drifting apart. */
export const CHECKOUT_APPROVAL: Approval = {
  tool: "Edit",
  filePath: `${CHECKOUT_DIR}/middleware/auth.ts`,
  diff: { added: 8, removed: 2 },
  diffText: `@@ -22,9 +22,14 @@ export async function authMiddleware(req: NextRequest) {
   const session = await getSession(req);

-  if (!session) return NextResponse.redirect(new URL("/login", req.url));
-  return NextResponse.next();
+  if (!session) {
+    const res = NextResponse.redirect(new URL("/login", req.url));
+    res.cookies.set("return_to", req.nextUrl.pathname, { sameSite: "lax", secure: true });
+    return res;
+  }
+  const res = NextResponse.next();
+  res.headers.set("x-session-id", session.id);
+  return res;
 }`,
};

const CHECKOUT_WAITING_APPROVAL: Session = {
  id: "checkout-redirect",
  name: "Fix checkout redirect loop",
  branch: "fix/checkout-redirect",
  repoName: "acme-web",
  workingDirectory: CHECKOUT_DIR,
  agentColor: "green",
  status: "waitingApproval",
  contextTokens: 88_000,
  maxContextTokens: 200_000,
  elapsed: "4m 39s",
  approval: CHECKOUT_APPROVAL,
};

export const WORKTREES: Worktree[] = [
  {
    branch: "fix/checkout-redirect",
    repoName: "acme-web",
    path: CHECKOUT_DIR,
    isActive: true,
    agentColor: "green",
    lastActivity: "now",
  },
  {
    branch: "feat/billing-webhooks",
    repoName: "acme-web",
    path: BILLING_DIR,
    isActive: true,
    agentColor: "cyan",
    lastActivity: "3m ago",
  },
  {
    branch: "refactor/auth-session",
    repoName: "acme-web",
    path: "/Users/ababol/Code/acme-web-refactor-auth-session",
    isActive: false,
    agentColor: "orange",
    lastActivity: "2h ago",
  },
  {
    branch: "chore/docs-readme",
    repoName: "acme-web",
    path: "/Users/ababol/Code/acme-web-chore-docs-readme",
    isActive: false,
    agentColor: "blue",
    lastActivity: "yesterday",
  },
];

// Module-init branch → worktree map for O(1) lookup in the Sessions list
// render path (synthesizeResumedSession runs on every render while any
// branch has been resumed).
const WORKTREE_BY_BRANCH: Record<string, Worktree> = Object.fromEntries(
  WORKTREES.map((w) => [w.branch, w]),
);

const LAUNCH_INTENT: LaunchIntent = {
  issueNumber: "482",
  branch: "fix/checkout-redirect",
  repoName: "acme-web",
};

export const TABS: Tab[] = [
  {
    id: "launch",
    label: "Launch",
    icon: Github,
    notch: { contextPercent: 0.14 },
    panel: {
      mode: "launch",
      intent: LAUNCH_INTENT,
      existing: [BILLING_WEBHOOKS],
      newcomer: CHECKOUT_LAUNCHING,
    },
  },
  {
    id: "approve",
    label: "Approve",
    icon: ShieldCheck,
    notch: { contextPercent: 0.44 },
    panel: {
      mode: "approve",
      hero: CHECKOUT_WAITING_APPROVAL,
      others: [BILLING_WEBHOOKS],
    },
  },
  {
    id: "resume",
    label: "Resume",
    icon: GitBranch,
    notch: { contextPercent: 0.22 },
    panel: { mode: "resume", worktrees: WORKTREES, cursor: 0 },
  },
];

/** Sessions surfaced in the Ghostty terminal for the Resume tab.
 *  Only the 2 active worktrees become terminal tabs — the idle ones
 *  (refactor/auth-session, chore/docs-readme) live as resumable cards in
 *  the notch panel, not as running terminal sessions. This keeps the
 *  terminal tab bar continuous across Approve → Resume. */
export const WORKTREE_SESSIONS: Session[] = [
  {
    ...CHECKOUT_LAUNCHING,
    currentTool: undefined,
    currentFilePath: undefined,
    elapsed: "9m 20s",
  },
  BILLING_WEBHOOKS,
];

/** Map a worktree branch to the terminal session id used throughout the
 *  demo. Single source of truth — imported by both `bnot-panel.tsx` and
 *  `terminals.tsx` so the synthesized "resumed" session cards, the
 *  worktree-click handler, and the terminal tab list all agree on ids. */
export function branchToSessionId(branch: string): string {
  if (branch === "fix/checkout-redirect") return "checkout-redirect";
  if (branch === "feat/billing-webhooks") return "billing-webhooks";
  if (branch === "refactor/auth-session") return "refactor-auth-session";
  if (branch === "chore/docs-readme") return "chore-docs-readme";
  return branch;
}

function branchToTitle(branch: string): string {
  if (branch === "fix/checkout-redirect") return "Fix checkout redirect loop";
  if (branch === "feat/billing-webhooks") return "Wire Stripe webhook handler";
  if (branch === "refactor/auth-session") return "Refactor auth session layer";
  if (branch === "chore/docs-readme") return "Polish README";
  return branch;
}

// Per-branch resume-card token counts; keeps context bar deterministic so
// the bar doesn't jitter between renders.
const RESUMED_CONTEXT_TOKENS: Record<string, number> = {
  "fix/checkout-redirect": 88_000,
  "feat/billing-webhooks": 54_000,
  "refactor/auth-session": 42_000,
  "chore/docs-readme": 18_000,
};

/** Build a synthesized `Session` for a worktree the user just resumed.
 *  Idle — resuming means attaching to an existing session, not starting a
 *  new tool run, so the card shows as idle (no blue spinner / bobbing
 *  bnot). Returns null for unknown branches, which shouldn't happen
 *  because clicks originate from the WORKTREES array. */
export function synthesizeResumedSession(branch: string): Session | null {
  const worktree = WORKTREE_BY_BRANCH[branch];
  if (!worktree) return null;
  return {
    id: branchToSessionId(branch),
    name: branchToTitle(branch),
    branch,
    repoName: worktree.repoName,
    workingDirectory: worktree.path,
    agentColor: worktree.agentColor,
    status: "idle",
    contextTokens: RESUMED_CONTEXT_TOKENS[branch] ?? 30_000,
    maxContextTokens: 200_000,
    elapsed: "just now",
  };
}
