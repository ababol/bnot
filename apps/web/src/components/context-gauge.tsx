import { useEffect, useRef, useState } from "react";
import type { BuddyColor } from "../lib/colors";
import { contextColor } from "../lib/colors";

interface Props {
  color: BuddyColor;
  percent: number;
  isActive: boolean;
}

export default function ContextGauge({ color: _color, percent, isActive }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState(0);

  // Animation timer: 500ms interval
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => f + 1), 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const px = Math.min(w / 8, h / 8);
    const ox = (w - px * 8) / 2;
    const oy = (h - px * 8) / 2;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);

    const fill = (x: number, y: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(ox + x * px, oy + y * px, px, px);
    };

    if (!isActive) {
      // Sleeping buddy
      const body = "rgba(255,255,255,0.8)";
      const ear = "rgba(255,255,255,0.6)";
      const closedEye = "rgba(255,255,255,0.3)";

      // Ears
      fill(1, 1, ear);
      fill(6, 1, ear);
      // Head
      for (let x = 1; x <= 6; x++) fill(x, 2, body);
      // Eyes row (closed)
      fill(1, 3, body);
      fill(2, 3, closedEye);
      fill(3, 3, closedEye);
      fill(4, 3, closedEye);
      fill(5, 3, closedEye);
      fill(6, 3, body);
      // Body
      for (let x = 1; x <= 6; x++) fill(x, 4, body);
      // Feet
      fill(1, 5, body);
      fill(2, 5, body);
      fill(5, 5, body);
      fill(6, 5, body);

      // Zzz animation
      const cycle = frame % 12;
      const zColor = (opacity: number) => `rgba(255,255,255,${opacity})`;
      // Small z
      const z1y = 1 - (cycle < 4 ? 0 : cycle < 8 ? 1 : 2);
      if (z1y >= -1 && z1y <= 2) fill(7, z1y + 2, zColor(0.42));
      // Medium z
      if (cycle >= 4) {
        const z2y = cycle < 8 ? 0 : -1;
        fill(7, z2y + 1, zColor(0.28));
      }
      // Large z
      if (cycle >= 8) fill(7, 0, zColor(0.14));
    } else {
      // Active battery buddy
      const blinking = frame % 20 === 0;
      const minRow = 1;
      const maxRow = 5;
      const fillRow = maxRow - Math.floor((maxRow - minRow) * Math.min(percent, 1.0));
      const ctxColor = contextColor(percent);
      const dim = "rgba(255,255,255,0.08)";
      const dark = "black";

      const pixels: [number, number, boolean, boolean][] = [
        [1, 1, true, false],
        [6, 1, true, false],
        [1, 2, false, false],
        [2, 2, false, false],
        [3, 2, false, false],
        [4, 2, false, false],
        [5, 2, false, false],
        [6, 2, false, false],
        [1, 3, false, false],
        [2, 3, false, true],
        [3, 3, false, false],
        [4, 3, false, false],
        [5, 3, false, true],
        [6, 3, false, false],
        [1, 4, false, false],
        [2, 4, false, false],
        [3, 4, false, false],
        [4, 4, false, false],
        [5, 4, false, false],
        [6, 4, false, false],
        [1, 5, false, false],
        [2, 5, false, false],
        [5, 5, false, false],
        [6, 5, false, false],
      ];

      for (const [x, y, isEar, isEye] of pixels) {
        let c: string;
        if (isEye) {
          c = blinking ? ctxColor : dark;
        } else if (isEar) {
          // ear: contextColor at 70% opacity
          c = ctxColor.replace("rgb(", "rgba(").replace(")", ",0.7)");
        } else if (y >= fillRow) {
          c = ctxColor;
        } else {
          c = dim;
        }
        fill(x, y, c);
      }
    }
  }, [frame, percent, isActive, _color]);

  // Breathing bob offset
  const bobY = isActive ? (frame % 6 < 3 ? -0.5 : 0.5) : 0;

  return (
    <canvas
      ref={canvasRef}
      width={56}
      height={36}
      className="h-[18px] w-[28px]"
      style={{ transform: `translateY(${bobY}px)`, imageRendering: "pixelated" }}
    />
  );
}
