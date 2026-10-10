import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Anthology, Settings, Story } from "./types";
import { isAnthology } from "./types";
import { loadSettings, loadStory, persistSettings } from "./lib/storage";
import { useStoryManager } from "./hooks";
import { StoryList } from "./components/StoryList";
import { NewStory, type Seed } from "./components/NewStory";
import { StoryDetail } from "./components/StoryDetail";
import { NewAnthology } from "./components/NewAnthology";
import { AnthologyDetail } from "./components/AnthologyDetail";
import { SettingsView } from "./components/SettingsView";
import { UpdateBanner } from "./components/Updater";

type View =
  | { name: "list" }
  | { name: "new"; seed?: Seed }
  | { name: "settings" }
  | { name: "detail"; id: string; tab?: string }
  | { name: "anthologies" }
  | { name: "anthology-new" }
  | { name: "anthology"; id: string };

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [view, setView] = useState<View>({ name: "list" });
  const [loadError, setLoadError] = useState("");
  const mgr = useStoryManager(settings);

  useEffect(() => persistSettings(settings), [settings]);

  // 本文の文字の大きさを画面全体に反映する
  useEffect(() => {
    document.documentElement.style.setProperty("--body-font-size", `${settings.bodyFontSize}px`);
  }, [settings.bodyFontSize]);

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

  const openAnthology = async (id: string) => {
    setLoadError("");
    try {
      await mgr.open(id);
      setView({ name: "anthology", id });
    } catch (e) {
      setLoadError(`物語を開けませんでした:${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const go = async (v: View) => {
    if (!mgr.run.running) await mgr.close();
    setView(v);
  };

  /** 物語の企画(キーワード・概要)を複製して、新規作成画面からやり直す。元の物語は変更しない。 */
  const duplicate = async (id: string) => {
    setLoadError("");
    try {
      await mgr.flush();
      const s = await loadStory(id);
      if (isAnthology(s)) return;
      await go({
        name: "new",
        seed: {
          title: s.title,
          keywords: s.keywords,
          note: s.note ?? "",
          concept: { title: s.title, tagline: s.tagline, genre: s.genre, synopsis: s.synopsis, characters: s.characters },
        },
      });
    } catch (e) {
      setLoadError(`複製できませんでした:${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const create = async (s: Story) => {
    await mgr.adopt(s);
    setView({ name: "detail", id: s.id, tab: "production" });
  };

  const createAnthology = async (a: Anthology) => {
    await mgr.adopt(a);
    setView({ name: "anthology", id: a.id });
  };

  /** 生成中のドキュメントを開く(サイドバーの「進捗を見る」) */
  const showRunning = () => {
    if (mgr.anthology) void openAnthology(mgr.anthology.id);
    else if (mgr.story) void openStory(mgr.story.id, "production");
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
          <small className="nav-label">長編</small>
          <button className={view.name === "list" || view.name === "detail" ? "active" : ""} onClick={() => void go({ name: "list" })}>
            📚 物語の一覧
          </button>
          <button className={view.name === "new" ? "active" : ""} onClick={() => void go({ name: "new" })}>
            ✨ 新しい物語
          </button>
          <small className="nav-label">短編集</small>
          <button className={view.name === "anthologies" || view.name === "anthology" ? "active" : ""} onClick={() => void go({ name: "anthologies" })}>
            📖 短編集の一覧
          </button>
          <button className={view.name === "anthology-new" ? "active" : ""} onClick={() => void go({ name: "anthology-new" })}>
            ✨ 新しい短編集
          </button>
          <small className="nav-label" />
          <button className={view.name === "settings" ? "active" : ""} onClick={() => void go({ name: "settings" })}>
            ⚙ 設定
          </button>
        </nav>
        {mgr.run.running && (
          <div className="side-run">
            <div className="running">● 生成中</div>
            <small>{mgr.run.stage}</small>
            {view.name !== "detail" && view.name !== "anthology" && mgr.doc && (
              <button className="small" onClick={showRunning}>
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
        {view.name === "anthologies" && (
          <StoryList key="anthology" kind="anthology" onOpen={(id) => void openAnthology(id)} onNew={() => void go({ name: "anthology-new" })} />
        )}
        {view.name === "anthology-new" && <NewAnthology settings={settings} onCreate={createAnthology} />}
        {view.name === "anthology" && mgr.anthology && mgr.anthology.id === view.id && (
          <AnthologyDetail
            key={mgr.anthology.id}
            anthology={mgr.anthology}
            settings={settings}
            run={mgr.run}
            mutate={(m) => mgr.mutate((d) => m(d as Anthology))}
            start={(t, episode) => void mgr.start(t, episode)}
            execute={(jobs) => void mgr.execute(jobs)}
            stop={mgr.stop}
            onBack={() => void go({ name: "anthologies" })}
          />
        )}
        {view.name === "list" && <StoryList key="novel" kind="novel" onOpen={(id, tab) => void openStory(id, tab)} onDuplicate={(id) => void duplicate(id)} onNew={() => void go({ name: "new" })} />}
        {view.name === "new" && <NewStory key={view.seed?.title ?? "blank"} settings={settings} seed={view.seed} onCreate={create} />}
        {view.name === "settings" && <SettingsView settings={settings} generating={mgr.run.running} onChange={setSettings} />}
        {view.name === "detail" && mgr.story && mgr.story.id === view.id && (
          <StoryDetail
            key={mgr.story.id}
            story={mgr.story}
            settings={settings}
            run={mgr.run}
            initialTab={view.tab}
            mutate={(m) => mgr.mutate((d) => m(d as Story))}
            start={(t) => void mgr.start(t)}
            stop={mgr.stop}
            onBack={() => void go({ name: "list" })}
            onDuplicate={() => void duplicate(mgr.story!.id)}
          />
        )}
      </main>
    </div>
  );
}
