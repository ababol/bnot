import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

interface MenuPos {
  x: number;
  y: number;
}

export default function ContextMenu() {
  const [pos, setPos] = useState<MenuPos | null>(null);

  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      setPos({ x: e.clientX, y: e.clientY });
    };
    const onClickAway = () => setPos(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPos(null);
    };
    window.addEventListener("contextmenu", onContext);
    window.addEventListener("mousedown", onClickAway);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("mousedown", onClickAway);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!pos) return null;

  const handleSettings = () => {
    invoke("open_settings");
    setPos(null);
  };
  const handleQuit = () => {
    invoke("quit_app");
    setPos(null);
  };

  return (
    <div
      className="fixed z-50 min-w-[140px] overflow-hidden rounded-md border border-white/10 bg-black py-1 text-xs text-text-secondary shadow-lg"
      style={{ top: pos.y, left: pos.x }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={handleSettings}
        className="block w-full cursor-pointer border-none bg-transparent px-3 py-1.5 text-left text-text-secondary hover:bg-white/10"
      >
        Settings
      </button>
      <button
        onClick={handleQuit}
        className="block w-full cursor-pointer border-none bg-transparent px-3 py-1.5 text-left text-text-secondary hover:bg-white/10"
      >
        Quit BuddyNotch
      </button>
    </div>
  );
}
