import { useEffect, useState } from "react";
import type { StorySummary } from "../types";
import { deleteStory, listStories } from "../lib/storage";
import { StatusBadge, formatDate } from "./ui";

export function StoryList(props: { onOpen: (id: string, tab?: string) => void; onNew: () => void }) {
  const [items, setItems] = useState<StorySummary[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const reload = () =>
    listStories()
      .then(setItems)
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
        <h2>物語の一覧</h2>
        <div className="row">
          <input className="search" placeholder="タイトル・キーワードで検索" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="primary" onClick={props.onNew}>
            ＋ 新しい物語
          </button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {items && items.length === 0 && (
        <div className="empty">
          <p>まだ物語がありません。</p>
          <button className="primary" onClick={props.onNew}>
            最初の物語を作る
          </button>
        </div>
      )}
      <div className="grid">
        {shown.map((s) => (
          <article key={s.id} className="story-card" onClick={() => props.onOpen(s.id)}>
            <div className="row between">
              <StatusBadge status={s.status} />
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
                {s.chapterCount ? `${s.chapterCount}章 / ${s.charCount.toLocaleString()}字` : "本文は未作成"}
              </span>
              <span className="row">
                <button
                  className="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onOpen(s.id, "body");
                  }}
                >
                  編集
                </button>
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
