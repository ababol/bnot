import { useEffect, useRef } from "react";
import type { BuddyColor } from "../lib/colors";
import { BUDDY_COLORS_RGB } from "../lib/colors";

interface Props {
  percent: number;
  color: BuddyColor;
  blockCount?: number;
}

export default function PixelProgressBar({ percent, color, blockCount = 12 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);

    const gap = 1.5 * 2; // 2x for retina
    const totalGaps = (blockCount - 1) * gap;
    const blockW = (w - totalGaps) / blockCount;
    const blockH = h;
    const filledCount = Math.floor(blockCount * Math.min(percent, 1.0));

    for (let i = 0; i < blockCount; i++) {
      const x = i * (blockW + gap);
      if (i < filledCount) {
        const intensity = i / blockCount;
        ctx.fillStyle = blockColor(intensity, color);
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.06)";
      }
      ctx.fillRect(x, 0, blockW, blockH);
    }
  }, [percent, color, blockCount]);

  return (
    <canvas
      ref={canvasRef}
      width={200}
      height={12}
      className="h-1.5 w-full"
      style={{ imageRendering: "pixelated" }}
    />
  );
}

function blockColor(intensity: number, color: BuddyColor): string {
  if (intensity > 0.85) return "rgb(255, 77, 51)";
  if (intensity > 0.7) return "rgb(255, 179, 51)";
  return BUDDY_COLORS_RGB[color];
}
