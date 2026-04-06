import { useEffect, useRef, useState } from "react";
import type { BuddyColor, BuddyTraits } from "../lib/colors";
import { BRIGHT_COLORS, MAIN_COLORS } from "../lib/colors";

interface Props {
  color: BuddyColor;
  isActive: boolean;
  traits?: BuddyTraits;
}

export default function PixelBuddy({ color, isActive, traits }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState(0);

  // color prop is the status-driven color; traits only controls shape
  const buddyColor = color;

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

    const main = MAIN_COLORS[buddyColor];
    const bright = BRIGHT_COLORS[buddyColor];
    const dark = "black";
    const blinking = isActive && frame % 20 === 0;

    const fill = (x: number, y: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(ox + x * px, oy + y * px, px, px);
    };

    // --- Hat ---
    const hat = traits?.hat ?? "none";
    if (hat === "cap") {
      for (let x = 2; x <= 5; x++) fill(x, 0, bright);
    } else if (hat === "horn") {
      fill(3, 0, bright);
      fill(4, 0, bright);
    } else if (hat === "crown") {
      fill(2, 0, bright);
      fill(4, 0, bright);
      fill(6, 0, bright);
    }

    // --- Ears ---
    const ears = traits?.ears ?? "both";
    if (ears === "both") {
      fill(1, 1, bright);
      fill(6, 1, bright);
    } else if (ears === "left") {
      fill(1, 1, bright);
    } else if (ears === "right") {
      fill(6, 1, bright);
    } else if (ears === "floppy") {
      fill(0, 2, bright);
      fill(7, 2, bright);
    }

    // Head
    for (let x = 1; x <= 6; x++) fill(x, 2, main);

    // --- Eyes ---
    const eyes = traits?.eyes ?? "normal";
    fill(1, 3, main);
    fill(3, 3, main);
    fill(4, 3, main);
    fill(6, 3, main);

    if (eyes === "normal") {
      fill(2, 3, blinking ? main : dark);
      fill(5, 3, blinking ? main : dark);
    } else if (eyes === "winkLeft") {
      fill(2, 3, main); // left eye always closed
      fill(5, 3, blinking ? main : dark);
    } else if (eyes === "winkRight") {
      fill(2, 3, blinking ? main : dark);
      fill(5, 3, main); // right eye always closed
    }

    // Body
    for (let x = 1; x <= 6; x++) fill(x, 4, main);

    // Feet
    fill(1, 5, main);
    fill(2, 5, main);
    fill(5, 5, main);
    fill(6, 5, main);
  }, [frame, buddyColor, isActive, traits]);

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
