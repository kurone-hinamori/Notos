import { useRef, useState } from "react";
import type { CharacterSheet, Settings, SharedCharacter } from "../types";
import { generateCast } from "../lib/pipeline";
import { toShared } from "../lib/anthology";
import { Field } from "./ui";

const FIELDS: [keyof CharacterSheet, string, number][] = [
  ["reading", "読み", 0],
  ["role", "役割", 0],
  ["age", "年齢", 0],
  ["appearance", "外見", 2],
  ["personality", "性格", 2],
  ["speech", "口調・呼称", 2],
  ["background", "経歴", 3],
  ["relations", "関係", 2],
];

const blank = (): CharacterSheet => ({
  name: "新しい人物",
  reading: "",
  role: "",
  age: "",
  appearance: "",
  personality: "",
  speech: "",
  background: "",
  relations: "",
  notes: "",
});

/** 短編集の共通の登場人物の編集(手入力・ガチャでの作成・経緯の確認)。 */
export function CastEditor(props: {
  cast: SharedCharacter[];
  onChange: (fn: (cast: SharedCharacter[]) => SharedCharacter[]) => void;
  settings: Settings;
  /** ガチャで考えるときの手がかり */
  context: { title: string; keywords: string[]; note: string; world: string };
  /** 世界観が未入力のとき、ガチャで考えた世界観を受け取る */
  onWorld?: (world: string) => void;
  /** 経緯の話の名前(例:第2話「…」) */
  episodeLabel?: (episodeId: string) => string;
}) {
  const { cast, onChange } = props;
  const [count, setCount] = useState(3);
  const [candidates, setCandidates] = useState<CharacterSheet[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);

  const pull = async () => {
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    try {
      const r = await generateCast(
        props.settings,
        { ...props.context, existing: cast.map((c) => c.name), count },
        abort.current.signal,
      );
      if (!r.characters.length) throw new Error("うまく生成できませんでした。もう一度引いてください。");
      setCandidates(r.characters);
      if (!props.context.world.trim() && r.world) props.onWorld?.(r.world);
    } catch (e) {
      if (!abort.current?.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const adopt = (c: CharacterSheet) => {
    onChange((list) => [...list, toShared(c)]);
    setCandidates((l) => l.filter((x) => x !== c));
  };

  return (
    <div className="stack">
      {cast.length === 0 && <p className="muted">共通の登場人物はまだいません。</p>}
      {cast.map((c, i) => (
        <details key={c.id} className="entry">
          <summary>
            <strong>{c.name}</strong> <span className="muted">{c.role}</span>
            {c.history.length > 0 && <span className="muted small-text"> ・経緯 {c.history.length}件</span>}
          </summary>
          <div className="row">
            <input
              className="grow"
              value={c.name}
              onChange={(e) => {
                const v = e.target.value;
                onChange((l) => l.map((x, j) => (j === i ? { ...x, name: v } : x)));
              }}
            />
            <button
              className="small danger"
              onClick={() => window.confirm(`共通の登場人物「${c.name}」を削除します。よろしいですか?`) && onChange((l) => l.filter((_, j) => j !== i))}
            >
              削除
            </button>
          </div>
          {FIELDS.map(([key, label, rows]) => (
            <Field
              key={key}
              label={label}
              rows={rows || undefined}
              value={c[key]}
              onChange={(v) => onChange((l) => l.map((x, j) => (j === i ? { ...x, [key]: v } : x)))}
            />
          ))}
          {c.history.length > 0 && (
            <div className="field">
              <span>これまでの経緯(連作短編で後の話に引き継がれます)</span>
              <ul className="history-list">
                {c.history.map((h, k) => (
                  <li key={k}>
                    <span className="muted small-text">{props.episodeLabel?.(h.episodeId) ?? ""}</span>
                    <input
                      value={h.text}
                      onChange={(e) => {
                        const v = e.target.value;
                        onChange((l) =>
                          l.map((x, j) => (j === i ? { ...x, history: x.history.map((y, m) => (m === k ? { ...y, text: v } : y)) } : x)),
                        );
                      }}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </details>
      ))}

      <div className="row wrap">
        <button onClick={() => onChange((l) => [...l, toShared(blank())])}>＋ 手入力で追加</button>
        <span className="muted">または</span>
        <label className="row">
          <input type="number" min={1} max={5} value={count} style={{ width: 60 }} onChange={(e) => setCount(Math.min(5, Math.max(1, Number(e.target.value) || 1)))} />
          名を
        </label>
        <button className="primary" disabled={busy} onClick={() => void pull()}>
          {busy ? "考え中…" : candidates.length ? "🎲 ガチャを引き直す" : "🎲 ガチャで考える"}
        </button>
        {busy && <button onClick={() => abort.current?.abort()}>中止</button>}
      </div>
      {error && <p className="error">{error}</p>}
      {candidates.length > 0 && (
        <div className="stack">
          <h4>ガチャの結果(気に入った人物を追加してください)</h4>
          <ul className="chars">
            {candidates.map((c, i) => (
              <li key={i}>
                <div className="row between">
                  <span>
                    <strong>{c.name}</strong>
                    {c.reading && <span className="muted">({c.reading})</span>} <span className="tag">{c.role}</span>
                  </span>
                  <button className="small primary" onClick={() => adopt(c)}>
                    ＋ 追加
                  </button>
                </div>
                <p>
                  {[c.age, c.appearance, c.personality].filter(Boolean).join(" / ")}
                  {c.speech && <><br />口調:{c.speech}</>}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="muted small-text">
        各話の設定資料にいる人物は、その話の「設定資料」タブの「共通の登場人物に登録」からも追加できます。
      </p>
    </div>
  );
}
