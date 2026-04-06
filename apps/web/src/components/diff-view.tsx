interface Props {
  diff: string;
}

export default function DiffView({ diff }: Props) {
  const lines = diff.split("\n");

  return (
    <div className="py-1.5 font-mono">
      {lines.map((line, i) => {
        const isAdd = line.startsWith("+") && !line.startsWith("+++");
        const isRemove = line.startsWith("-") && !line.startsWith("---");
        const isHeader = line.startsWith("@@");

        const prefix = isAdd ? "+" : isRemove ? "-" : " ";
        const content = isAdd || isRemove ? line.slice(1) : line;

        const colorClass = isAdd
          ? "text-buddy-green"
          : isRemove
            ? "text-buddy-red"
            : isHeader
              ? "text-buddy-cyan"
              : "text-white/50";

        const bgClass = isAdd ? "bg-buddy-green/8" : isRemove ? "bg-buddy-red/8" : "";

        const showLineNum = !isHeader && !line.startsWith("---") && !line.startsWith("+++");

        return (
          <div key={i} className={`flex items-baseline px-1.5 py-px ${bgClass}`}>
            <span className="w-7 shrink-0 pr-1.5 text-right text-[9px] text-white/25">
              {showLineNum ? i + 1 : ""}
            </span>
            <span
              className={`w-3 shrink-0 text-[10px] font-bold ${isAdd || isRemove ? colorClass : "text-transparent"}`}
            >
              {prefix}
            </span>
            <span className={`truncate text-[10px] ${colorClass}`}>{content}</span>
          </div>
        );
      })}
    </div>
  );
}
