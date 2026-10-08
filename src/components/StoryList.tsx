import { useEffect, useState } from "react";
import type { StorySummary } from "../types";
import { deleteStory, listStories } from "../lib/storage";
import { StatusBadge, formatDate } from "./ui";

export function StoryList(props: {
  /** novel: 長編の一覧、anthology: 短編集の一覧 */
  kind: "novel" | "anthology";
  onOpen: (id: string, tab?: string) => void;
  onNew: () => void;
  onDuplicate?: (id: string) => void;
}) {
  const anthology = props.kind === "anthology";
  const noun = anthology ? "短編集" : "物語";
  const [items, setItems] = useState<StorySummary[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const reload = () =>
    listStories()
      // 以前のバージョンで作った物語には kind がないので、長編として扱う
      .then((list) => setItems(list.filter((s) => (s.kind ?? "novel") === props.kind)))
      .catch((e) => setError(String(e)));
  useEffect(() => {
    void reload();
  }, []);

  const remove = async (s: StorySummary) => {
    if (!window.confirm(`「${s.title}」を削除します。元に戻せません。よろしいですか?`)) return;
    await deleteStory(s.id);
    await reload();
  };

  const q = query.trim().toLowerCase();
  const shown = (items ?? []).filter(
    (s) => !q || [s.title, s.synopsis, s.keywords.join(" ")].join(" ").toLowerCase().includes(q),
  );

  return (
    <div className="page">
      <header className="page-head">
        <h2>{anthology ? "短編集の一覧" : "物語の一覧"}</h2>
        <div className="row">
          <input className="search" placeholder="タイトル・キーワードで検索" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="primary" onClick={props.onNew}>
            ＋ 新しい{noun}
          </button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {items && items.length === 0 && (
        <div className="empty">
          <p>まだ{noun}がありません。</p>
          {anthology && <p>短編集では、1話ずつガチャで概要を決めて、1話完結の短編を書いていきます。</p>}
          <button className="primary" onClick={props.onNew}>
            最初の{noun}を作る
          </button>
        </div>
      )}
      <div className="grid">
        {shown.map((s) => (
          <article key={s.id} className="story-card" onClick={() => props.onOpen(s.id)}>
            <div className="row between">
              {anthology ? (
                <span className={`badge badge-${s.status}`}>
                  {s.doneCount}/{s.chapterCount}話 完成
                </span>
              ) : (
                <StatusBadge status={s.status} />
              )}
              <span className="muted small-text">{formatDate(s.updatedAt)}</span>
            </div>
            <h3>{s.title || "(無題)"}</h3>
            {s.tagline && <p className="tagline">{s.tagline}</p>}
            <p className="synopsis">{s.synopsis}</p>
            <div className="tags">
              {s.keywords.map((k) => (
                <span key={k} className="tag">
                  {k}
                </span>
              ))}
            </div>
            <footer className="row between">
              <span className="muted small-text">
                {anthology
                  ? `全${s.chapterCount}話 / ${s.charCount.toLocaleString()}字`
                  : s.chapterCount
                    ? `${s.chapterCount}章 / ${s.charCount.toLocaleString()}字`
                    : "本文は未作成"}
              </span>
              <span className="row">
                {!anthology && (
                  <button
                    className="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onOpen(s.id, "body");
                    }}
                  >
                    編集
                  </button>
                )}
                {props.onDuplicate && (
                  <button
                    className="small"
                    title="キーワードを修正して、ガチャからやり直す(元の物語は残ります)"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onDuplicate?.(s.id);
                    }}
                  >
                    複製
                  </button>
                )}
                <button
                  className="small danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(s);
                  }}
                >
                  削除
                </button>
              </span>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
