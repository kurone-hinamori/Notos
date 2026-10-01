import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type State =
  | { kind: "idle" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; percent: number }
  | { kind: "error"; message: string };

/** 起動時に GitHub Releases の最新版を確認し、あれば更新を案内するバナー。 */
export function UpdateBanner() {
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    check()
      .then((u) => u && setState({ kind: "available", update: u }))
      .catch(() => {
        /* 開発時やオフライン時は何もしない */
      });
  }, []);

  if (state.kind === "idle") return null;

  const install = async (update: Update) => {
    let total = 0;
    let done = 0;
    setState({ kind: "downloading", percent: 0 });
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") {
          done += ev.data.chunkLength;
          setState({ kind: "downloading", percent: total ? Math.round((done / total) * 100) : 0 });
        }
      });
      await relaunch();
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="banner">
      {state.kind === "available" && (
        <>
          <span>新しいバージョン {state.update.version} があります。</span>
          <button className="primary small" onClick={() => void install(state.update)}>
            更新して再起動
          </button>
          <button className="small" onClick={() => setState({ kind: "idle" })}>
            あとで
          </button>
        </>
      )}
      {state.kind === "downloading" && <span>更新をダウンロード中… {state.percent}%</span>}
      {state.kind === "error" && (
        <>
          <span>更新に失敗しました:{state.message}</span>
          <button className="small" onClick={() => setState({ kind: "idle" })}>
            閉じる
          </button>
        </>
      )}
    </div>
  );
}
