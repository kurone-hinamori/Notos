import { useRef, useState } from "react";
import type { Concept, Settings, Story } from "../types";
import { pullConcept } from "../lib/pipeline";
import { createStory } from "../lib/storage";

/** 前後の空白を除き、空欄と重複を取り除く。 */
function cleanKeywords(list: string[]): string[] {
  return [...new Set(list.map((k) => k.trim()).filter(Boolean))];
}

interface Pull {
  concept: Concept;
  keywords: string[];
}

export function NewStory(props: { settings: Settings; onCreate: (s: Story) => Promise<void> }) {
  const { settings } = props;
  const [keywords, setKeywords] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [pulls, setPulls] = useState<Pull[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);

  const addKeywords = (text: string) => {
    setKeywords(cleanKeywords([...keywords, ...text.split(/[,、，\s]+/)]));
    setDraft("");
  };

  const pull = async () => {
    const kws = cleanKeywords([...keywords, ...draft.split(/[,、，\s]+/)]);
    if (!kws.length) {
      setError("キーワードを1つ以上入力してください");
      return;
    }
    setKeywords(kws);
    setDraft("");
    setError("");
    setBusy(true);
    abort.current = new AbortController();
    try {
      const concept = await pullConcept(
        settings,
        kws,
        note,
        pulls.slice(0, 8).map((p) => p.concept.title),
        abort.current.signal,
      );
      if (!concept.title || !concept.synopsis) throw new Error("うまく生成できませんでした。もう一度引いてください。");
      setPulls((p) => [{ concept, keywords: kws }, ...p]);
      setIndex(0);
    } catch (e) {
      if (!abort.current?.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const current = pulls[index];

  return (
    <div className="page">
      <header className="page-head">
        <h2>新しい物語</h2>
      </header>
      <div className="two-col">
        <section className="card">
          <h3>キーワード</h3>
          <p className="muted">物語の核にしたい言葉を入力してください(Enter / 読点で追加)。追加したキーワードはクリックして修正でき、修正後にガチャを引き直せます。</p>
          <div className="chips">
            {keywords.map((k, i) => (
              <span key={i} className="chip">
                <input
                  className="chip-input"
                  aria-label={`キーワード ${i + 1}`}
                  value={k}
                  size={Math.max(2, k.length * 2)}
                  onChange={(e) => setKeywords(keywords.map((x, j) => (j === i ? e.target.value : x)))}
                  onBlur={() => setKeywords(cleanKeywords(keywords))}
                  onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
                />
                <button aria-label={`${k}を削除`} onClick={() => setKeywords(keywords.filter((_, j) => j !== i))}>
                  ×
                </button>
              </span>
            ))}
            <input
              value={draft}
              placeholder="例:魔法学園, 幼なじみ, 時間遡行"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  addKeywords(draft);
                }
              }}
              onBlur={() => draft.trim() && addKeywords(draft)}
            />
          </div>
          <label className="field">
            <span>補足の希望(任意)</span>
            <textarea
              rows={3}
              value={note}
              placeholder="例:主人公は女性、切ないが最後は救いのある結末に"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="row">
            <button className="primary big" disabled={busy} onClick={() => void pull()}>
              {busy ? "考え中…" : pulls.length ? "🎲 もう一度ガチャを引く" : "🎲 ガチャを引く"}
            </button>
            {busy && (
              <button onClick={() => abort.current?.abort()}>中止</button>
            )}
          </div>
          {error && <p className="error">{error}</p>}
          {pulls.length > 1 && (
            <>
              <h4>これまでの案</h4>
              <ul className="history">
                {pulls.map((p, i) => (
                  <li key={i}>
                    <button className={i === index ? "active" : ""} onClick={() => setIndex(i)}>
                      {p.concept.title}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="card concept">
          {!current && <p className="muted">ここにタイトル・あらすじ・登場人物の案が表示されます。気に入るまで何度でもガチャを引けます。</p>}
          {current && (
            <>
              <div className="muted small-text">{current.concept.genre}</div>
              <h2>{current.concept.title}</h2>
              <p className="tagline">{current.concept.tagline}</p>
              <h4>あらすじ</h4>
              <p className="prose">{current.concept.synopsis}</p>
              <h4>登場人物</h4>
              <ul className="chars">
                {current.concept.characters.map((c) => (
                  <li key={c.name}>
                    <strong>{c.name}</strong>
                    <span className="tag">{c.role}</span>
                    <p>{c.summary}</p>
                  </li>
                ))}
              </ul>
              <div className="row">
                <button
                  className="primary big"
                  onClick={() => void props.onCreate(createStory(current.concept, current.keywords, settings.author))}
                >
                  この内容で物語を作る →
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
