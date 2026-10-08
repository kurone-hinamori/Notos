import type { ReactNode } from "react";
import type { Concept, Settings, SharedContext } from "../types";
import { pullConcept } from "../lib/pipeline";
import type { ShortSpec } from "../lib/prompts";

/** 前後の空白を除き、空欄と重複を取り除く。 */
export function cleanKeywords(list: string[]): string[] {
  return [...new Set(list.map((k) => k.trim()).filter(Boolean))];
}

export interface Pull {
  concept: Concept;
  keywords: string[];
  note: string;
  /** 複製元・やり直し前の案 */
  origin?: boolean;
}

/**
 * ガチャ画面の状態。画面を切り替えても引いた案やガチャの結果が失われないよう、
 * 状態は呼び出し側が保持する。
 */
export interface GachaState {
  keywords: string[];
  /** 手入力したタイトル(空ならガチャで考える) */
  title: string;
  draft: string;
  note: string;
  pulls: Pull[];
  index: number;
  busy: boolean;
  error: string;
  abort?: AbortController;
}

export function initialGacha(keywords: string[], note: string, origin?: Concept): GachaState {
  return {
    keywords: [...keywords],
    title: "",
    draft: "",
    note,
    pulls: origin ? [{ concept: origin, keywords: [...keywords], note, origin: true }] : [],
    index: 0,
    busy: false,
    error: "",
  };
}

const splitWords = (text: string) => text.split(/[,、，\s]+/);

export function ConceptGacha(props: {
  settings: Settings;
  state: GachaState;
  update: (fn: (s: GachaState) => GachaState) => void;
  /** 短編として考える場合の目標文字数 */
  short?: ShortSpec;
  /** 内容が被らないようにする既存の案のタイトル */
  avoidTitles?: string[];
  /** 短編集から渡す共有情報(共通の登場人物など) */
  shared?: SharedContext;
  /** キーワード欄の上に表示する追加の入力(出演者の選択など) */
  extra?: ReactNode;
  confirmLabel: string;
  onConfirm: (pull: Pull) => void;
}) {
  const { state: st, update } = props;

  const addKeywords = (text: string) =>
    update((s) => ({ ...s, keywords: cleanKeywords([...s.keywords, ...splitWords(text)]), draft: "" }));

  const pull = async () => {
    const kws = cleanKeywords([...st.keywords, ...splitWords(st.draft)]);
    if (!kws.length && !st.title.trim() && !props.shared?.characters.length) {
      update((s) => ({ ...s, error: "キーワードかタイトルを入力してください" }));
      return;
    }
    const abort = new AbortController();
    const note = st.note;
    update((s) => ({ ...s, keywords: kws, draft: "", error: "", busy: true, abort }));
    try {
      const avoid = [...st.pulls.slice(0, 8).map((p) => p.concept.title), ...(props.avoidTitles ?? [])];
      const concept = await pullConcept(
        props.settings,
        { keywords: kws, note, avoidTitles: avoid, short: props.short, title: st.title, shared: props.shared },
        abort.signal,
      );
      if (!concept.title || !concept.synopsis) throw new Error("うまく生成できませんでした。もう一度引いてください。");
      update((s) => ({ ...s, busy: false, abort: undefined, pulls: [{ concept, keywords: kws, note }, ...s.pulls], index: 0 }));
    } catch (e) {
      const message = abort.signal.aborted ? "" : e instanceof Error ? e.message : String(e);
      update((s) => ({ ...s, busy: false, abort: undefined, error: message }));
    }
  };

  const current = st.pulls[st.index];

  return (
    <div className="two-col">
      <section className="card">
        {props.extra}
        <label className="field">
          <span>タイトル(任意・入力するとこのタイトルで案を考えます)</span>
          <input
            value={st.title}
            placeholder="空欄ならガチャでタイトルも考えます"
            onChange={(e) => {
              const v = e.target.value;
              update((s) => ({ ...s, title: v }));
            }}
          />
        </label>
        <h3>キーワード</h3>
        <p className="muted">
          物語の核にしたい言葉を入力してください(Enter / 読点で追加)。追加したキーワードはクリックして修正でき、修正後にガチャを引き直せます。
        </p>
        <div className="chips">
          {st.keywords.map((k, i) => (
            <span key={i} className="chip">
              <input
                className="chip-input"
                aria-label={`キーワード ${i + 1}`}
                value={k}
                size={Math.max(2, k.length * 2)}
                onChange={(e) => {
                  const v = e.target.value;
                  update((s) => ({ ...s, keywords: s.keywords.map((x, j) => (j === i ? v : x)) }));
                }}
                onBlur={() => update((s) => ({ ...s, keywords: cleanKeywords(s.keywords) }))}
                onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
              />
              <button aria-label={`${k}を削除`} onClick={() => update((s) => ({ ...s, keywords: s.keywords.filter((_, j) => j !== i) }))}>
                ×
              </button>
            </span>
          ))}
          <input
            value={st.draft}
            placeholder="例:魔法学園, 幼なじみ, 時間遡行"
            onChange={(e) => {
              const v = e.target.value;
              update((s) => ({ ...s, draft: v }));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                addKeywords(st.draft);
              }
            }}
            onBlur={() => st.draft.trim() && addKeywords(st.draft)}
          />
        </div>
        <label className="field">
          <span>補足の希望(任意)</span>
          <textarea
            rows={3}
            value={st.note}
            placeholder="例:主人公は女性、切ないが最後は救いのある結末に"
            onChange={(e) => {
              const v = e.target.value;
              update((s) => ({ ...s, note: v }));
            }}
          />
        </label>
        <div className="row">
          <button className="primary big" disabled={st.busy} onClick={() => void pull()}>
            {st.busy ? "考え中…" : st.pulls.length ? "🎲 もう一度ガチャを引く" : "🎲 ガチャを引く"}
          </button>
          {st.busy && <button onClick={() => st.abort?.abort()}>中止</button>}
        </div>
        {st.error && <p className="error">{st.error}</p>}
        {st.pulls.length > 1 && (
          <>
            <h4>これまでの案</h4>
            <ul className="history">
              {st.pulls.map((p, i) => (
                <li key={i}>
                  <button className={i === st.index ? "active" : ""} onClick={() => update((s) => ({ ...s, index: i }))}>
                    {p.origin && "【元の案】"}
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
              {current.concept.characters.map((c, i) => (
                <li key={i}>
                  <strong>{c.name}</strong>
                  <span className="tag">{c.role}</span>
                  <p>{c.summary}</p>
                </li>
              ))}
            </ul>
            <div className="row">
              <button className="primary big" onClick={() => props.onConfirm(current)}>
                {props.confirmLabel}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
