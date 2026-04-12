import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

export async function runUpdateCheck() {
  try {
    const update = await check();
    if (!update?.available) return;
    await update.downloadAndInstall();
    await relaunch();
  } catch (err) {
    console.warn("[updater] check failed", err);
  }
}
