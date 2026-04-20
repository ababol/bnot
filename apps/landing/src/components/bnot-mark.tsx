import PixelBnot from "./pixel-bnot";

type Size = "lg" | "sm";

type BnotMarkProps = {
  href?: string;
  size?: Size;
  hoverAnim?: boolean;
};

export function BnotMark({ href = "#", size = "lg", hoverAnim = false }: BnotMarkProps) {
  const label = size === "sm" ? "text-base" : "text-lg";
  const logo = hoverAnim ? (
    <span className="transition-transform group-hover:scale-110 inline-flex">
      <PixelBnot color="green" size={size} isActive />
    </span>
  ) : (
    <PixelBnot color="green" size={size} isActive />
  );
  return (
    <a href={href} className={`flex items-center gap-2.5${hoverAnim ? " group" : ""}`}>
      {logo}
      <span className={`${label} font-medium tracking-[-0.02em] text-text-primary`}>Bnot</span>
    </a>
  );
}
