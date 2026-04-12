import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";

interface Props {
  onAction?: () => void;
}

/** Menu items shared by the right-click Settings flyout and the gear dropdown:
 *  edit the JSON config, toggle "Launch at login". */
export default function SettingsMenu({ onAction }: Props) {
  const [autostartOn, setAutostartOn] = useState<boolean | null>(null);

  useEffect(() => {
    isEnabled()
      .then(setAutostartOn)
      .catch(() => setAutostartOn(null));
  }, []);

  const handleEditConfig = () => {
    invoke("open_settings");
    onAction?.();
  };

  const handleToggleAutostart = async () => {
    try {
      if (autostartOn) {
        await disable();
        setAutostartOn(false);
      } else {
        await enable();
        setAutostartOn(true);
      }
    } catch {
      // ignore — permission or plist write failed
    }
  };

  const handleQuit = () => {
    invoke("quit_app");
    onAction?.();
  };

  return (
    <>
      <button
        onClick={handleEditConfig}
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left text-text-secondary hover:bg-white/10"
      >
        <span className="w-3" />
        <span>Edit config</span>
      </button>
      <button
        onClick={handleToggleAutostart}
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left text-text-secondary hover:bg-white/10"
      >
        <span className="w-3 text-text-dim">{autostartOn ? "\u2713" : ""}</span>
        <span>Launch at login</span>
      </button>
      <div className="my-1 h-px bg-white/10" />
      <button
        onClick={handleQuit}
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left text-text-secondary hover:bg-white/10"
      >
        <span className="w-3" />
        <span>Quit BuddyNotch</span>
      </button>
    </>
  );
}
