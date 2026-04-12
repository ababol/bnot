import { useEffect, useRef, useState } from "react";
import { MAIN_COLORS } from "../lib/colors";

export default function PixelBell() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => f + 1), 600);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const px = Math.min(w / 7, h / 8);
    const ox = (w - px * 7) / 2;
    const oy = (h - px * 8) / 2;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);

    const c = MAIN_COLORS.orange;

    const fill = (x: number, y: number) => {
      ctx.fillStyle = c;
      ctx.fillRect(ox + x * px, oy + y * px, px, px);
    };

    // Bell shape (7x8 grid)
    //    ##
    //   ####
    //  ######
    //  ######
    //  ######
    //  ######
    // ########
    //    ##
    fill(2, 0); fill(3, 0);
    fill(1, 1); fill(2, 1); fill(3, 1); fill(4, 1);
    fill(1, 2); fill(2, 2); fill(3, 2); fill(4, 2);
    fill(1, 3); fill(2, 3); fill(3, 3); fill(4, 3);
    fill(1, 4); fill(2, 4); fill(3, 4); fill(4, 4);
    fill(0, 5); fill(1, 5); fill(2, 5); fill(3, 5); fill(4, 5); fill(5, 5);
    fill(2, 6); fill(3, 6);
  }, [frame]);

  // Subtle swing animation
  const angle = Math.sin(frame * 0.5) * 8;

  return (
    <canvas
      ref={canvasRef}
      width={28}
      height={32}
      className="h-[16px] w-[14px]"
      style={{ transform: `rotate(${angle}deg)`, imageRendering: "pixelated" }}
    />
  );
}
