import type { TerminalLine } from "./demo-state";
import type { Approval } from "./tabs";

export type DiffRow = {
  marker: " " | "+" | "-";
  num: number;
  content: string;
};

/** Render the unified-diff hunk from `approval.diffText` as terminal lines
 *  with a short stat row and per-line gutter (marker + line number) — the
 *  same layout real Claude Code uses after a tool-call ● Edit(path).
 *  Ids are stable + indexed so Approve's inline append and Resume's
 *  pre-baked transcript dedup cleanly via the render-time seen-ids pass. */
export function approveDiffLines(sessionId: string, approval: Approval): TerminalLine[] {
  if (!approval.diffText || !approval.diff) return [];
  const fileName = approval.filePath ? (approval.filePath.split("/").pop() ?? "file") : "file";
  const stat: TerminalLine = {
    id: `${sessionId}-a-diff-stat`,
    kind: "dim",
    text: `  ⎿ Updated ${fileName} with ${approval.diff.added} additions and ${approval.diff.removed} removals`,
  };
  const body: TerminalLine[] = parseDiffHunk(approval.diffText).map((b, i) => ({
    id: `${sessionId}-a-diff-${i}`,
    kind: "diff",
    text: b.content,
    diffMeta: { marker: b.marker, num: b.num },
  }));
  return [stat, ...body];
}

/** Parse a single unified-diff hunk into per-line rows. The `@@ -old +new @@`
 *  header seeds both counters; we expose the *new* line number on context +
 *  add rows and the *old* line number on remove rows. Unknown shapes are
 *  silently skipped — this is demo content, not a general parser, so
 *  anything malformed just drops out of the preview. */
export function parseDiffHunk(diffText: string): DiffRow[] {
  const rawLines = diffText.split("\n");
  const header = rawLines[0] ?? "";
  const m = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (!m) return [];
  let oldN = parseInt(m[1], 10);
  let newN = parseInt(m[2], 10);
  const out: DiffRow[] = [];
  for (const line of rawLines.slice(1)) {
    if (line.startsWith("+")) {
      out.push({ marker: "+", num: newN++, content: line.slice(1) });
    } else if (line.startsWith("-")) {
      out.push({ marker: "-", num: oldN++, content: line.slice(1) });
    } else {
      out.push({ marker: " ", num: newN, content: line.startsWith(" ") ? line.slice(1) : line });
      oldN++;
      newN++;
    }
  }
  return out;
}
