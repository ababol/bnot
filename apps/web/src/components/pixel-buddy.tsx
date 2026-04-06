import { useEffect, useRef, useState } from "react";
import type { BuddyColor } from "../lib/colors";
import { BRIGHT_COLORS, MAIN_COLORS } from "../lib/colors";

interface Props {
  color: BuddyColor;
  isActive: boolean;
}

export default function PixelBuddy({ color, isActive }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setFrame((f) => f + 1), 500);
    return () => clearInterval(id);
  }, [isActive]);

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

    const main = MAIN_COLORS[color];
    const bright = BRIGHT_COLORS[color];
    const dark = "black";
    const blinking = isActive && frame % 20 === 0;

    const fill = (x: number, y: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(ox + x * px, oy + y * px, px, px);
    };

    // Ears
    fill(1, 1, bright);
    fill(6, 1, bright);
    // Head
    for (let x = 1; x <= 6; x++) fill(x, 2, main);
    // Eyes
    fill(1, 3, main);
    fill(2, 3, blinking ? main : dark);
    fill(3, 3, main);
    fill(4, 3, main);
    fill(5, 3, blinking ? main : dark);
    fill(6, 3, main);
    // Body
    for (let x = 1; x <= 6; x++) fill(x, 4, main);
    // Feet
    fill(1, 5, main);
    fill(2, 5, main);
    fill(5, 5, main);
    fill(6, 5, main);
  }, [frame, color, isActive]);

  const bobY = isActive ? (frame % 6 < 3 ? -0.5 : 0.5) : 0;

  return (
    <canvas
      ref={canvasRef}
      width={32}
      height={28}
      className="h-[14px] w-4"
      style={{ transform: `translateY(${bobY}px)`, imageRendering: "pixelated" }}
    />
  );
}
