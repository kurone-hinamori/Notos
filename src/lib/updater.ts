import type { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** 更新をダウンロードしてインストールし、アプリを再起動する。onProgress には 0〜100 の進捗が渡る。 */
export async function installUpdate(update: Update, onProgress: (percent: number) => void): Promise<void> {
  let total = 0;
  let done = 0;
  onProgress(0);
  await update.downloadAndInstall((ev) => {
    if (ev.event === "Started") total = ev.data.contentLength ?? 0;
    if (ev.event === "Progress") {
      done += ev.data.chunkLength;
      onProgress(total ? Math.round((done / total) * 100) : 0);
    }
  });
  await relaunch();
}
