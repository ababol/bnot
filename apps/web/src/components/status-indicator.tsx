import { useEffect, useRef, useState } from "react";
import type { StatusDot } from "../lib/colors";
import { STATUS_DOT_COLORS } from "../lib/colors";

interface Props {
  dot: StatusDot;
  size?: "sm" | "lg";
}

const SIZE: Record<
  NonNullable<Props["size"]>,
  { display: number; canvas: number; grid: number }
> = {
  sm: { display: 10, canvas: 20, grid: 10 },
  lg: { display: 20, canvas: 40, grid: 10 },
};

// Ring of 8 dot positions for the spinner (each 2x2 on a 10x10 grid).
const SPINNER_POSITIONS: Array<[number, number]> = [
  [4, 0], // N
  [7, 1], // NE
  [8, 4], // E
  [7, 7], // SE
  [4, 8], // S
  [1, 7], // SW
  [0, 4], // W
  [1, 1], // NW
];

// Checkmark pixels on a 10x10 grid.
const CHECK_PIXELS: Array<[number, number]> = [
  [7, 2],
  [8, 2],
  [6, 3],
  [7, 3],
  [5, 4],
  [6, 4],
  [4, 5],
  [5, 5],
  [1, 5],
  [2, 5],
  [3, 5],
  [2, 6],
  [3, 6],
  [4, 6],
  [3, 7],
];

// Question mark pixels on a 10x10 grid.
const QUESTION_PIXELS: Array<[number, number]> = [
  [3, 1],
  [4, 1],
  [5, 1],
  [6, 1],
  [2, 2],
  [7, 2],
  [7, 3],
  [6, 4],
  [5, 4],
  [4, 5],
  [4, 6],
  [4, 8],
];

const SPIN_INTERVAL_MS = 90;

export default function StatusIndicator({ dot, size = "sm" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);
  const { display, canvas, grid } = SIZE[size];

  const animate = dot === "working";

  useEffect(() => {
    if (!animate) return;
    const id = setInterval(() => setTick((t) => t + 1), SPIN_INTERVAL_MS);
    return () => clearInterval(id);
  }, [animate]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    const px = canvas / grid;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas, canvas);

    const color = STATUS_DOT_COLORS[dot];

    const fill = (x: number, y: number, alpha = 1) => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fillRect(x * px, y * px, px * 2, px * 2);
    };

    const fillSingle = (x: number, y: number, alpha = 1) => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fillRect(x * px, y * px, px, px);
    };

    if (dot === "working") {
      const lead = tick % SPINNER_POSITIONS.length;
      for (let i = 0; i < SPINNER_POSITIONS.length; i++) {
        const dist = (lead - i + SPINNER_POSITIONS.length) % SPINNER_POSITIONS.length;
        const alpha =
          dist === 0 ? 1 : dist === 1 ? 0.65 : dist === 2 ? 0.35 : dist === 3 ? 0.15 : 0;
        if (alpha === 0) continue;
        const [x, y] = SPINNER_POSITIONS[i];
        fill(x, y, alpha);
      }
    } else if (dot === "done") {
      for (const [x, y] of CHECK_PIXELS) fillSingle(x, y);
    } else if (dot === "waiting") {
      for (const [x, y] of QUESTION_PIXELS) fillSingle(x, y);
    } else if (dot === "planning") {
      // Three vertical dots, center row pulses via alpha
      fillSingle(4, 3);
      fillSingle(5, 3);
      fillSingle(4, 5);
      fillSingle(5, 5);
      fillSingle(4, 7);
      fillSingle(5, 7);
    } else {
      // idle: 4x4 centered block
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = color;
      ctx.fillRect(3 * px, 3 * px, px * 4, px * 4);
    }

    ctx.globalAlpha = 1;
  }, [dot, tick, canvas, grid]);

  return (
    <canvas
      ref={canvasRef}
      width={canvas}
      height={canvas}
      style={{
        width: display,
        height: display,
        imageRendering: "pixelated",
      }}
    />
  );
}
