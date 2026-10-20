import { useState } from "react";
import type { Anthology, AnthologyMode, EntryKind, Settings, SharedCharacter, SharedEntry } from "../types";
import { createAnthology } from "../lib/storage";
import { Field, Section } from "./ui";
import { cleanKeywords } from "./ConceptGacha";
import { CastEditor } from "./CastEditor";
import { SharedEntriesEditor } from "./SharedEntriesEditor";
import { ModeSelect } from "./AnthologyDetail";

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

export function NewAnthology(props: { settings: Settings; serial?: boolean; onCreate: (a: Anthology) => Promise<void> }) {
  // カクヨム連載:連作短編として作り、1話=4回分、1回分は約2,250字(2,000〜2,500字)
  const serial = !!props.serial;
  const [title, setTitle] = useState("");
  const [keywords, setKeywords] = useState("");
  const [note, setNote] = useState("");
  const [genre, setGenre] = useState("");
  const [episodes, setEpisodes] = useState(12);
  const [scenes, setScenes] = useState(4);
  const [chars, setChars] = useState(serial ? 2250 : 2000);
  const [mode, setMode] = useState<AnthologyMode>("series");
  const [world, setWorld] = useState("");
  const [cast, setCast] = useState<SharedCharacter[]>([]);
  const [shared, setShared] = useState<Partial<Record<EntryKind, SharedEntry[]>>>({});
  const kwList = cleanKeywords(keywords.split(/[,、，\s]+/));
  const perEpisode = scenes * chars;

  const create = () =>
    void props.onCreate(
      createAnthology({
        title: title.trim() || (serial ? "無題の連載" : "無題の短編集"),
        keywords: kwList,
        note,
        author: props.settings.author,
        episodes,
        scenes,
        charsPerScene: chars,
        world,
        cast,
        shared,
        genre: genre.trim(),
        format: serial ? "kakuyomu" : "anthology",
        mode: serial ? "series" : mode,
      }),
    );

  return (
    <div className="page narrow">
      <header className="page-head">
        <h2>{serial ? "新しい連載(カクヨム)" : "新しい短編集"}</h2>
      </header>
      <div className="stack">
        {serial && (
          <p className="muted">
            カクヨムに連載する作品を作ります。連載の名前の下に話(カクヨムの「章」)が並び、各話は4回分(カクヨムの「エピソード」)に分けて投稿します。
            1回分は約2,000〜2,500字で、それぞれにサブタイトルを付けます。12話で文庫本1冊分(約10万字)になります。
            キャッチコピー・紹介文・タグは、作成後に「連載の情報」タブで自動で作ったり編集したりできます。
          </p>
        )}
        <p className="muted" hidden={serial}>
          1話完結の短編をまとめた本を作ります。各話の概要(タイトル・あらすじ・登場人物)は、ガチャで1話ずつ決めることも、
          「おまかせ」で前の話が書き上がるたびに自動で作らせることもできます。
          各話の執筆ではその話の設定資料と共通の設定だけを参照するので、話数が多くても内容が欠けにくくなります。
        </p>
        <Section title={serial ? "連載の情報" : "短編集の情報"}>
          <Field label={serial ? "連載の名前(作品名。あとで変更できます)" : "短編集のタイトル(あとで変更できます)"} value={title} placeholder="無題の短編集" onChange={setTitle} />
          <Field
            label="ジャンル(全話共通。空欄の場合は、話ごとにガチャで決まります)"
            value={genre}
            placeholder="例:異世界ファンタジー、現代ラブコメ、ミステリー"
            onChange={setGenre}
          />
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
        <Section title={serial ? "世界観" : "短編集の種類"}>
          {!serial && <ModeSelect mode={mode} onChange={setMode} />}
          <Field
            label="共通の世界観・舞台(任意。全話に適用されます)"
            rows={3}
            value={world}
            placeholder="例:海辺の小さな町にある、雨の日だけ開く喫茶店"
            onChange={setWorld}
          />
        </Section>
        <Section title="共通の登場人物(任意。あとから追加・変更できます)">
          <p className="muted small-text">
            複数の話に登場する人物です。各話でガチャを引く前に出演させる人物を選ぶと、その話では同一人物として扱われます。
          </p>
          <CastEditor
            cast={cast}
            onChange={(fn) => setCast(fn)}
            settings={props.settings}
            context={{ title, keywords: kwList, note, world }}
            onWorld={setWorld}
          />
        </Section>
        <Section title="共通の場所・品物・用語(任意。あとから追加・変更できます)">
          <p className="muted small-text">
            複数の話に出てくる場所や重要な品物を決めておくと、話ごとに設定が変わるのを防げます。
          </p>
          <SharedEntriesEditor
            shared={shared}
            onChange={(fn) => setShared(fn)}
            settings={props.settings}
            context={{ title, keywords: kwList, note, world, cast: cast.map((c) => c.name) }}
          />
        </Section>
        <Section title="規模">
          <div className="three-col">
            <NumberInput label="話数" value={episodes} min={1} max={30} onChange={setEpisodes} />
            <NumberInput label={serial ? "1話あたりの連載回数" : "1話あたりの場面数"} value={scenes} min={2} max={8} onChange={setScenes} />
            <NumberInput label={serial ? "1回分の文字数(目安)" : "1場面の文字数(目安)"} value={chars} min={600} max={4000} step={100} onChange={setChars} />
          </div>
          <p className="muted">
            1話あたり約 {perEpisode.toLocaleString()} 字 × {episodes} 話 = 約 {(perEpisode * episodes).toLocaleString()} 字(文庫本1冊は約8〜10万字)。
            話数はあとから増減でき、話ごとに規模を変えることもできます。
          </p>
        </Section>
        <div className="row">
          <button className="primary big" onClick={create}>
            {serial ? "連載を作成する →" : "短編集を作成する →"}
          </button>
        </div>
      </div>
    </div>
  );
}
