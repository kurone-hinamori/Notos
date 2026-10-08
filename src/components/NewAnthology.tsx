import { useState } from "react";
import type { Anthology, Settings } from "../types";
import { createAnthology } from "../lib/storage";
import { Field, Section } from "./ui";
import { cleanKeywords } from "./ConceptGacha";

function NumberInput(props: { label: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={(e) => props.onChange(Math.min(props.max, Math.max(props.min, Number(e.target.value) || props.min)))}
      />
    </label>
  );
}

export function NewAnthology(props: { settings: Settings; onCreate: (a: Anthology) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [keywords, setKeywords] = useState("");
  const [note, setNote] = useState("");
  const [episodes, setEpisodes] = useState(12);
  const [scenes, setScenes] = useState(4);
  const [chars, setChars] = useState(2000);
  const perEpisode = scenes * chars;

  const create = () =>
    void props.onCreate(
      createAnthology({
        title: title.trim() || "無題の短編集",
        keywords: cleanKeywords(keywords.split(/[,、，\s]+/)),
        note,
        author: props.settings.author,
        episodes,
        scenes,
        charsPerScene: chars,
      }),
    );

  return (
    <div className="page narrow">
      <header className="page-head">
        <h2>新しい短編集</h2>
      </header>
      <div className="stack">
        <p className="muted">
          1話ずつガチャを引いて概要(タイトル・あらすじ・登場人物)を決め、1話完結の短編として本文を生成します。
          各話の執筆ではその話の設定資料だけを参照するので、話数が多くても内容が欠けにくくなります。
        </p>
        <Section title="短編集の情報">
          <Field label="短編集のタイトル(あとで変更できます)" value={title} placeholder="無題の短編集" onChange={setTitle} />
          <Field
            label="全話に共通するキーワード(任意・読点区切り。各話のガチャの初期値になります)"
            value={keywords}
            placeholder="例:喫茶店, 雨の日"
            onChange={setKeywords}
          />
          <Field
            label="全話に共通する補足の希望(任意)"
            rows={2}
            value={note}
            placeholder="例:どの話も最後は少し温かい気持ちになる結末に"
            onChange={setNote}
          />
        </Section>
        <Section title="規模">
          <div className="three-col">
            <NumberInput label="話数" value={episodes} min={1} max={30} onChange={setEpisodes} />
            <NumberInput label="1話あたりの場面数" value={scenes} min={2} max={8} onChange={setScenes} />
            <NumberInput label="1場面の文字数(目安)" value={chars} min={600} max={4000} step={100} onChange={setChars} />
          </div>
          <p className="muted">
            1話あたり約 {perEpisode.toLocaleString()} 字 × {episodes} 話 = 約 {(perEpisode * episodes).toLocaleString()} 字(文庫本1冊は約8〜10万字)。
            話数はあとから増減でき、話ごとに規模を変えることもできます。
          </p>
        </Section>
        <div className="row">
          <button className="primary big" onClick={create}>
            短編集を作成して、第1話のガチャへ →
          </button>
        </div>
      </div>
    </div>
  );
}
