import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Settings, Story } from "./types";
import { loadSettings, persistSettings } from "./lib/storage";
import { useStoryManager } from "./hooks";
import { StoryList } from "./components/StoryList";
import { NewStory } from "./components/NewStory";
import { StoryDetail } from "./components/StoryDetail";
import { SettingsView } from "./components/SettingsView";
import { UpdateBanner } from "./components/Updater";

type View =
  | { name: "list" }
  | { name: "new" }
  | { name: "settings" }
  | { name: "detail"; id: string; tab?: string };

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [view, setView] = useState<View>({ name: "list" });
  const [loadError, setLoadError] = useState("");
  const mgr = useStoryManager(settings);

  useEffect(() => persistSettings(settings), [settings]);

  // タイトルバーにバージョンを表示する
  useEffect(() => {
    getVersion()
      .then((v) => getCurrentWindow().setTitle(`Notos v${v}`))
      .catch(() => undefined);
  }, []);

  const openStory = async (id: string, tab?: string) => {
    setLoadError("");
    try {
      await mgr.open(id);
      setView({ name: "detail", id, tab });
    } catch (e) {
      setLoadError(`物語を開けませんでした:${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const go = async (v: View) => {
    if (!mgr.run.running) await mgr.close();
    setView(v);
  };

  const create = async (s: Story) => {
    await mgr.adopt(s);
    setView({ name: "detail", id: s.id, tab: "production" });
  };

  const noModel = !settings.model;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">物</span>
          <div>
            <strong>Notos</strong>
            <small>物語を紡ぐ</small>
          </div>
        </div>
        <nav>
          <button className={view.name === "list" || view.name === "detail" ? "active" : ""} onClick={() => void go({ name: "list" })}>
            📚 物語の一覧
          </button>
          <button className={view.name === "new" ? "active" : ""} onClick={() => void go({ name: "new" })}>
            ✨ 新しい物語
          </button>
          <button className={view.name === "settings" ? "active" : ""} onClick={() => void go({ name: "settings" })}>
            ⚙ 設定
          </button>
        </nav>
        {mgr.run.running && (
          <div className="side-run">
            <div className="running">● 生成中</div>
            <small>{mgr.run.stage}</small>
            {view.name !== "detail" && mgr.story && (
              <button className="small" onClick={() => void openStory(mgr.story!.id, "production")}>
                進捗を見る
              </button>
            )}
          </div>
        )}
        <div className="side-model muted" title={settings.model}>
          {settings.model ? `モデル: ${settings.model}` : "モデル未選択"}
        </div>
      </aside>

      <main className="main">
        <UpdateBanner />
        {noModel && view.name !== "settings" && (
          <p className="notice">
            使用するモデルが未選択です。<button className="link" onClick={() => void go({ name: "settings" })}>設定画面</button>で選択してください。
          </p>
        )}
        {loadError && <p className="error">{loadError}</p>}
        {view.name === "list" && <StoryList onOpen={(id, tab) => void openStory(id, tab)} onNew={() => void go({ name: "new" })} />}
        {view.name === "new" && <NewStory settings={settings} onCreate={create} />}
        {view.name === "settings" && <SettingsView settings={settings} generating={mgr.run.running} onChange={setSettings} />}
        {view.name === "detail" && mgr.story && mgr.story.id === view.id && (
          <StoryDetail
            key={mgr.story.id}
            story={mgr.story}
            settings={settings}
            run={mgr.run}
            initialTab={view.tab}
            mutate={mgr.mutate}
            start={(t) => void mgr.start(t)}
            stop={mgr.stop}
            onBack={() => void go({ name: "list" })}
          />
        )}
      </main>
    </div>
  );
}
