import { useEffect, useRef, useState } from "react";
import type { BuddyColor, BuddyTraits } from "../lib/colors";
import { BRIGHT_COLORS, MAIN_COLORS } from "../lib/colors";

interface Props {
  color: BuddyColor;
  identityColor?: BuddyColor;
  isActive: boolean;
  traits?: BuddyTraits;
}

export default function PixelBuddy({ color, identityColor, isActive, traits }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState(0);

  const headColor = identityColor ?? color;
  const bodyColor = color;

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

    const headMain = MAIN_COLORS[headColor];
    const headBright = BRIGHT_COLORS[headColor];
    const bodyMain = MAIN_COLORS[bodyColor];
    const dark = "black";
    const blinking = isActive && frame % 20 === 0;

    const fill = (x: number, y: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(ox + x * px, oy + y * px, px, px);
    };

    // --- Hat (identity color) ---
    const hat = traits?.hat ?? "none";
    if (hat === "cap") {
      for (let x = 2; x <= 5; x++) fill(x, 0, headBright);
    } else if (hat === "horn") {
      fill(3, 0, headBright);
      fill(4, 0, headBright);
    } else if (hat === "crown") {
      fill(2, 0, headBright);
      fill(4, 0, headBright);
      fill(6, 0, headBright);
    }

    // --- Ears (identity color) ---
    const ears = traits?.ears ?? "both";
    if (ears === "both") {
      fill(1, 1, headBright);
      fill(6, 1, headBright);
    } else if (ears === "left") {
      fill(1, 1, headBright);
    } else if (ears === "right") {
      fill(6, 1, headBright);
    } else if (ears === "floppy") {
      fill(0, 2, headBright);
      fill(7, 2, headBright);
    }

    // Head (identity color)
    for (let x = 1; x <= 6; x++) fill(x, 2, headMain);

    // --- Eyes (identity color) ---
    const eyes = traits?.eyes ?? "normal";
    fill(1, 3, headMain);
    fill(3, 3, headMain);
    fill(4, 3, headMain);
    fill(6, 3, headMain);

    if (eyes === "normal") {
      fill(2, 3, blinking ? headMain : dark);
      fill(5, 3, blinking ? headMain : dark);
    } else if (eyes === "winkLeft") {
      fill(2, 3, headMain); // left eye always closed
      fill(5, 3, blinking ? headMain : dark);
    } else if (eyes === "winkRight") {
      fill(2, 3, blinking ? headMain : dark);
      fill(5, 3, headMain); // right eye always closed
    }

    // Body (status color)
    for (let x = 1; x <= 6; x++) fill(x, 4, bodyMain);

    // Feet (status color)
    fill(1, 5, bodyMain);
    fill(2, 5, bodyMain);
    fill(5, 5, bodyMain);
    fill(6, 5, bodyMain);
  }, [frame, headColor, bodyColor, isActive, traits]);

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
