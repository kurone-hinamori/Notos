import { useRef, useState } from "react";
import type { Entry, EntryKind, Settings, SharedEntry } from "../types";
import { generateEntries } from "../lib/pipeline";
import { ENTRY_KINDS, ENTRY_LABEL, toSharedEntry } from "../lib/anthology";

type Shared = Partial<Record<EntryKind, SharedEntry[]>>;

const HINT: Record<EntryKind, string> = {
  places: "何度も舞台になる場所(店、学校、町など)",
  items: "物語の鍵になる品物・道具(形見、武器、手紙など)",
  terms: "固有の用語・組織・決まりごと",
};

/** 短編集の共通の設定(場所・品物・用語)の編集(手入力・ガチャでの作成・経緯の確認)。 */
export function SharedEntriesEditor(props: {
  shared: Shared;
  onChange: (fn: (shared: Shared) => Shared) => void;
  settings: Settings;
  /** ガチャで考えるときの手がかり */
  context: { title: string; keywords: string[]; note: string; world: string; cast: string[] };
  /** 経緯の話の名前(例:第2話「…」) */
  episodeLabel?: (episodeId: string) => string;
}) {
  return (
    <div className="stack">
      {ENTRY_KINDS.map((kind) => (
        <KindEditor key={kind} kind={kind} {...props} />
      ))}
      <p className="muted small-text">
        共通の設定は全話に渡され、「必要な場合だけ登場させる。登場させるなら名称・設定を変えない」と指示されます。
        各話の設定資料にある項目は、その話の「設定資料」タブの「共通の設定に登録」からも追加できます。
      </p>
    </div>
  );
}

function KindEditor(props: {
  kind: EntryKind;
  shared: Shared;
  onChange: (fn: (shared: Shared) => Shared) => void;
  settings: Settings;
  context: { title: string; keywords: string[]; note: string; world: string; cast: string[] };
  episodeLabel?: (episodeId: string) => string;
}) {
  const { kind } = props;
  const list = props.shared[kind] ?? [];
  const [count, setCount] = useState(2);
  const [candidates, setCandidates] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);

  const setList = (fn: (l: SharedEntry[]) => SharedEntry[]) => props.onChange((s) => ({ ...s, [kind]: fn(s[kind] ?? []) }));
  const patch = (i: number, p: Partial<SharedEntry>) => setList((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const pull = async () => {
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    try {
      const r = await generateEntries(
        props.settings,
        { kind, ...props.context, existing: list.map((e) => e.name), count },
        abort.current.signal,
      );
      if (!r.length) throw new Error("うまく生成できませんでした。もう一度引いてください。");
      setCandidates(r);
    } catch (e) {
      if (!abort.current?.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  return (
    <div className="stack">
      <h4>
        共通の{ENTRY_LABEL[kind]} <span className="muted small-text">{HINT[kind]}</span>
      </h4>
      {list.map((e, i) => (
        <div key={e.id} className="entry">
          <div className="row">
            <input className="grow" value={e.name} onChange={(ev) => patch(i, { name: ev.target.value })} />
            <button
              className="small danger"
              onClick={() => window.confirm(`共通の${ENTRY_LABEL[kind]}「${e.name}」を削除します。よろしいですか?`) && setList((l) => l.filter((_, j) => j !== i))}
            >
              削除
            </button>
          </div>
          <textarea rows={2} value={e.description} placeholder="外見・特徴・由来・できること/できないこと" onChange={(ev) => patch(i, { description: ev.target.value })} />
          {e.history.length > 0 && (
            <div className="field">
              <span>これまでの経緯(連作短編で後の話に引き継がれます)</span>
              <ul className="history-list">
                {e.history.map((h, k) => (
                  <li key={k}>
                    <span className="muted small-text">{props.episodeLabel?.(h.episodeId) ?? ""}</span>
                    <input
                      value={h.text}
                      onChange={(ev) => patch(i, { history: e.history.map((y, m) => (m === k ? { ...y, text: ev.target.value } : y)) })}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
      <div className="row wrap">
        <button onClick={() => setList((l) => [...l, toSharedEntry({ name: `新しい${ENTRY_LABEL[kind]}`, description: "" })])}>＋ 手入力で追加</button>
        <span className="muted">または</span>
        <label className="row">
          <input type="number" min={1} max={5} value={count} style={{ width: 60 }} onChange={(e) => setCount(Math.min(5, Math.max(1, Number(e.target.value) || 1)))} />
          件を
        </label>
        <button disabled={busy} onClick={() => void pull()}>
          {busy ? "考え中…" : candidates.length ? "🎲 ガチャを引き直す" : "🎲 ガチャで考える"}
        </button>
        {busy && <button onClick={() => abort.current?.abort()}>中止</button>}
      </div>
      {error && <p className="error">{error}</p>}
      {candidates.length > 0 && (
        <ul className="chars">
          {candidates.map((c, i) => (
            <li key={i}>
              <div className="row between">
                <strong>{c.name}</strong>
                <button
                  className="small primary"
                  onClick={() => {
                    setList((l) => [...l, toSharedEntry(c)]);
                    setCandidates((l) => l.filter((x) => x !== c));
                  }}
                >
                  ＋ 追加
                </button>
              </div>
              <p>{c.description}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
