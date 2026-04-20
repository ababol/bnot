import { parseDiffHunk } from "../lib/terminal-diff";

interface Props {
  diff: string;
}

export function DiffView({ diff }: Props) {
  const rows = parseDiffHunk(diff);

  return (
    <div className="py-1 font-mono">
      {rows.map((row, i) => {
        const isAdd = row.marker === "+";
        const isRemove = row.marker === "-";

        const bgClass = isAdd ? "bg-bnot-green/15" : isRemove ? "bg-bnot-red/15" : "";
        const textClass = isAdd ? "text-bnot-green" : isRemove ? "text-bnot-red" : "text-white/60";
        const numClass = isAdd
          ? "text-bnot-green/60"
          : isRemove
            ? "text-bnot-red/60"
            : "text-white/20";

        return (
          <div key={i} className={`flex px-2 py-px ${bgClass}`}>
            <span className={`w-6 shrink-0 pr-1.5 text-right text-[10px] ${numClass}`}>
              {row.num}
            </span>
            <span className={`whitespace-pre-wrap break-all text-[10.5px] ${textClass}`}>
              {row.marker}
              {row.content}
            </span>
          </div>
        );
      })}
    </div>
  );
}
