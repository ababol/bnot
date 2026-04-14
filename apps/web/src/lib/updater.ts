import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

export type UpdateStatus = "idle" | "checking" | "downloading" | "up-to-date" | "error";

export async function runUpdateCheck(onStatus?: (status: UpdateStatus) => void): Promise<boolean> {
  onStatus?.("checking");
  try {
    const update = await check();
    if (!update?.available) {
      onStatus?.("up-to-date");
      return false;
    }
    onStatus?.("downloading");
    await update.downloadAndInstall();
    await relaunch();
    return true;
  } catch (err) {
    console.warn("[updater] check failed", err);
    onStatus?.("error");
    return false;
  }
}
