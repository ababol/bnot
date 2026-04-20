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

const SPIN_INTERVAL_MS = 180;
const PLAN_INTERVAL_MS = 200;
const ZZZ_INTERVAL_MS = 400;

const ZZZ_POSITIONS: Array<[number, number, number]> = [
  [0, 6, 0],
  [3, 3, 1],
  [6, 0, 2],
];

export default function StatusIndicator({ dot, size = "sm" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);
  const { display, canvas, grid } = SIZE[size];

  const animate = dot === "working" || dot === "idle" || dot === "planning";
  const intervalMs =
    dot === "working" ? SPIN_INTERVAL_MS : dot === "planning" ? PLAN_INTERVAL_MS : ZZZ_INTERVAL_MS;

  useEffect(() => {
    if (!animate) return;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [animate, intervalMs]);

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
      const dotPixels: Array<[number, number]> = [
        [4, 3],
        [5, 3],
        [3, 4],
        [4, 4],
        [5, 4],
        [6, 4],
        [3, 5],
        [4, 5],
        [5, 5],
        [6, 5],
        [4, 6],
        [5, 6],
      ];
      for (const [x, y] of dotPixels) fillSingle(x, y);

      const rimPositions: Array<[number, number]> = [
        [4, 0],
        [7, 1],
        [8, 4],
        [7, 7],
        [4, 8],
        [1, 7],
        [0, 4],
        [1, 1],
      ];
      const n = rimPositions.length;
      const lead = tick % n;
      for (let i = 0; i < n; i++) {
        const distBehind = (lead - i + n) % n;
        const alpha = 0.12 + 0.88 * Math.pow(1 - distBehind / n, 1.6);
        const [x, y] = rimPositions[i];
        fill(x, y, alpha);
      }
    } else if (dot === "done") {
      for (const [x, y] of CHECK_PIXELS) fillSingle(x, y);
    } else if (dot === "waiting") {
      for (const [x, y] of QUESTION_PIXELS) fillSingle(x, y);
    } else if (dot === "planning") {
      const bars = [
        { y: 2, x0: 2, x1: 7 },
        { y: 5, x0: 2, x1: 6 },
        { y: 8, x0: 2, x1: 5 },
      ];
      const active = tick % 9;
      for (let b = 0; b < 3; b++) {
        const barStart = b * 3;
        const frame = active - barStart;
        const alpha = frame === 2 ? 0.9 : frame === 1 ? 0.6 : frame === 0 ? 0.35 : 0.1;
        const { y, x0, x1 } = bars[b];
        for (let x = x0; x <= x1; x++) fillSingle(x, y, alpha);
      }
    } else {
      for (const [col, row, phase] of ZZZ_POSITIONS) {
        const alpha = 0.35 + 0.55 * ((Math.sin((tick + phase) * 0.8) + 1) / 2);
        fillSingle(col, row, alpha);
        fillSingle(col + 1, row, alpha);
        fillSingle(col + 2, row, alpha);
        fillSingle(col + 1, row + 1, alpha);
        fillSingle(col, row + 2, alpha);
        fillSingle(col + 1, row + 2, alpha);
        fillSingle(col + 2, row + 2, alpha);
      }
    }

    ctx.globalAlpha = 1;
  }, [dot, tick, canvas, grid]);

  return (
    <canvas
      ref={canvasRef}
      width={canvas}
      height={canvas}
      className="pixelated"
      style={{ width: display, height: display }}
    />
  );
}
