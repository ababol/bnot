import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import { useSession } from "../context/session-context";
import { formatResetAt } from "../lib/format";
import { isSoundEnabled, setSoundEnabled } from "../lib/sound";
import { runUpdateCheck, type UpdateStatus } from "../lib/updater";

interface Props {
  onAction?: () => void;
}

/** Menu items shared by the right-click Settings flyout and the gear dropdown:
 *  edit the JSON config, toggle "Launch at login". */
export default function SettingsMenu({ onAction }: Props) {
  const { state } = useSession();
  const { hookHealth, usageStats } = state;
  const [autostartOn, setAutostartOn] = useState<boolean | null>(null);
  const [soundOn, setSoundOn] = useState<boolean>(() => isSoundEnabled());
  const [repairing, setRepairing] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");

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

  const handleToggleSound = () => {
    const next = !soundOn;
    setSoundEnabled(next);
    setSoundOn(next);
  };

  const handleRepairHooks = async () => {
    setRepairing(true);
    try {
      await invoke("repair_hooks");
    } finally {
      setRepairing(false);
    }
  };

  const handleQuit = () => {
    invoke("quit_app");
    onAction?.();
  };

  return (
    <>
      {hookHealth && (
        <div className="flex w-full items-center gap-2 px-3 py-1.5 text-text-secondary">
          <span
            className={`h-1.5 w-1.5 rounded-full ${hookHealth.status === "healthy" ? "bg-bnot-green" : "bg-bnot-orange"}`}
          />
          <span className="flex-1 text-xs">
            Hooks: {hookHealth.status === "healthy" ? "OK" : "Issues"}
          </span>
          {hookHealth.status === "degraded" && (
            <button
              onClick={handleRepairHooks}
              disabled={repairing}
              className="cursor-pointer rounded border-none bg-white/10 px-1.5 py-0.5 text-xs text-text-secondary hover:bg-white/20 disabled:opacity-50"
            >
              {repairing ? "…" : "Repair"}
            </button>
          )}
        </div>
      )}
      {usageStats && (
        <div className="flex flex-col gap-0.5 whitespace-nowrap px-3 py-1 text-xs text-text-dim">
          {usageStats.fiveHour && (
            <div>
              5h: {Math.round(usageStats.fiveHour.usedPercent)}% ·{" "}
              {formatResetAt(usageStats.fiveHour.resetsAt)}
            </div>
          )}
          {usageStats.sevenDay && (
            <div>
              7d: {Math.round(usageStats.sevenDay.usedPercent)}% ·{" "}
              {formatResetAt(usageStats.sevenDay.resetsAt)}
            </div>
          )}
        </div>
      )}
      {(hookHealth || usageStats) && <div className="my-1 h-px bg-white/10" />}
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
      <button
        onClick={handleToggleSound}
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left text-text-secondary hover:bg-white/10"
      >
        <span className="w-3 text-text-dim">{soundOn ? "\u2713" : ""}</span>
        <span>Enable sound</span>
      </button>
      <button
        onClick={() => runUpdateCheck(setUpdateStatus)}
        disabled={updateStatus === "checking" || updateStatus === "downloading"}
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left text-text-secondary hover:bg-white/10 disabled:opacity-50"
      >
        <span className="w-3 text-text-dim">{updateStatus === "up-to-date" ? "\u2713" : ""}</span>
        <span>
          {
            {
              checking: "Checking...",
              downloading: "Updating...",
              "up-to-date": "Up to date",
              error: "Update failed",
              idle: "Check for updates",
            }[updateStatus]
          }
        </span>
      </button>
      <div className="my-1 h-px bg-white/10" />
      <button
        onClick={handleQuit}
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left text-text-secondary hover:bg-white/10"
      >
        <span className="w-3" />
        <span>Quit Bnot</span>
      </button>
    </>
  );
}
