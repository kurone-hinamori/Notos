import { useState } from "react";
import type { Settings, Story } from "../types";
import type { RunState } from "../hooks";
import type { Task } from "../lib/pipeline";
import { storyChars } from "../lib/text";
import { StatusBadge } from "./ui";
import { OverviewTab } from "./tabs/OverviewTab";
import { BodyTab } from "./tabs/BodyTab";
import { BibleTab } from "./tabs/BibleTab";
import { ProductionTab } from "./tabs/ProductionTab";
import { ExportTab } from "./tabs/ExportTab";

export type Mutate = (m: (draft: Story) => void) => void;

const TABS = [
  ["overview", "概要"],
  ["production", "制作"],
  ["body", "本文"],
  ["bible", "設定資料"],
  ["art", "表紙・挿絵"],
  ["export", "EPUB出力"],
] as const;

export type TabId = (typeof TABS)[number][0];

export function StoryDetail(props: {
  story: Story;
  settings: Settings;
  run: RunState;
  initialTab?: string;
  mutate: Mutate;
  start: (t: Task) => void;
  stop: () => void;
  onBack: () => void;
}) {
  const { story, run, mutate } = props;
  const [tab, setTab] = useState<TabId>(
    (TABS.find(([id]) => id === props.initialTab)?.[0] ?? (story.chapters.length ? "body" : "production")) as TabId,
  );
  const running = run.running && run.storyId === story.id;
  const busyElsewhere = run.running && run.storyId !== story.id;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <button className="link" onClick={props.onBack}>
            ← 一覧へ
          </button>
          <h2>
            {story.title || "(無題)"} <StatusBadge status={story.status} />
          </h2>
          <span className="muted small-text">
            {story.chapters.length ? `${story.chapters.length}章 / ${storyChars(story).toLocaleString()}字` : "本文は未作成"}
          </span>
        </div>
        {running && <span className="running">● 生成中:{run.stage}</span>}
      </header>

      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {busyElsewhere && <p className="notice">別の物語を生成中のため、生成は開始できません。</p>}

      {tab === "overview" && <OverviewTab story={story} mutate={mutate} />}
      {tab === "production" && (
        <ProductionTab story={story} run={run} mutate={mutate} start={props.start} stop={props.stop} disabled={busyElsewhere} />
      )}
      {tab === "body" && <BodyTab story={story} mutate={mutate} start={props.start} running={run.running} />}
      {tab === "bible" && <BibleTab story={story} mutate={mutate} start={props.start} running={run.running} />}
      {tab === "art" && <ArtTab />}
      {tab === "export" && <ExportTab story={story} author={props.settings.author} mutate={mutate} />}
    </div>
  );
}

function ArtTab() {
  const items = [
    ["表紙", "物語の世界観に合わせた表紙イラスト"],
    ["カラー口絵", "巻頭を飾るカラーイラスト"],
    ["挿絵(白黒)", "場面ごとの白黒挿絵"],
  ];
  return (
    <div className="grid">
      {items.map(([title, desc]) => (
        <section key={title} className="card placeholder">
          <h3>{title}</h3>
          <p className="muted">{desc}</p>
          <div className="soon">準備中</div>
          <small className="muted">画像生成アプリとの連携機能は今後追加予定です。</small>
          <button disabled>生成する</button>
        </section>
      ))}
    </div>
  );
}
