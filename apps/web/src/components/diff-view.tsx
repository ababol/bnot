interface Props {
  diff: string;
}

export default function DiffView({ diff }: Props) {
  const lines = diff.split("\n");

  // Parse @@ header for starting line number
  let lineNum = 1;
  const headerMatch = lines[0]?.match(/@@ -(\d+)/);
  if (headerMatch) {
    lineNum = parseInt(headerMatch[1], 10);
  }

  // Skip @@ header line for rendering
  const displayLines = headerMatch ? lines.slice(1) : lines;

  return (
    <div className="py-1 font-mono">
      {displayLines.map((line, i) => {
        const isAdd = line.startsWith("+") && !line.startsWith("+++");
        const isRemove = line.startsWith("-") && !line.startsWith("---");
        const isContext = line.startsWith(" ");

        const bgClass = isAdd ? "bg-buddy-green/15" : isRemove ? "bg-buddy-red/15" : "";

        const textClass = isAdd
          ? "text-buddy-green"
          : isRemove
            ? "text-buddy-red"
            : "text-white/60";

        const numClass = isAdd
          ? "text-buddy-green/60"
          : isRemove
            ? "text-buddy-red/60"
            : "text-white/20";

        // Compute line number: context and added lines advance the counter,
        // removed lines show the old line number but don't advance
        const currentNum = lineNum;
        if (isContext || isAdd) lineNum++;
        if (isRemove) lineNum++;

        return (
          <div key={i} className={`flex px-2 py-px ${bgClass}`}>
            <span className={`w-8 shrink-0 pr-2 text-right text-[11px] ${numClass}`}>
              {currentNum}
            </span>
            <span className={`whitespace-pre-wrap break-all text-[11px] ${textClass}`}>{line}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Count added/removed lines in a diff string */
export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}
