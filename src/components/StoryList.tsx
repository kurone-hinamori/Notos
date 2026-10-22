import { useEffect, useState } from "react";
import type { StorySummary } from "../types";
import { listStories } from "../lib/storage";
import { StatusBadge, formatDate } from "./ui";

export function StoryList(props: {
  /** novel: 長編の一覧、anthology: 短編集の一覧 */
  kind: "novel" | "anthology" | "serial";
  onOpen: (id: string, tab?: string) => void;
  onNew: () => void;
  onDuplicate?: (id: string) => void;
  /** 削除する(開いている物語の場合は、その状態も片付ける) */
  onDelete: (id: string) => Promise<void>;
}) {
  // 短編集とカクヨム連載は、どちらも話の集まり(anthology)として保存している
  const anthology = props.kind !== "novel";
  const serial = props.kind === "serial";
  const noun = serial ? "連載" : anthology ? "短編集" : "物語";
  const [items, setItems] = useState<StorySummary[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const reload = () =>
    listStories()
      // 以前のバージョンで作った物語には kind がないので、長編として扱う
      .then((list) =>
        setItems(
          list.filter((s) =>
            props.kind === "novel"
              ? (s.kind ?? "novel") === "novel"
              : s.kind === "anthology" && (s.format === "kakuyomu") === (props.kind === "serial"),
          ),
        ),
      )
      .catch((e) => setError(String(e)));
  useEffect(() => {
    void reload();
  }, []);

  const remove = async (s: StorySummary) => {
    if (!window.confirm(`「${s.title}」を削除します。元に戻せません。よろしいですか?`)) return;
    try {
      await props.onDelete(s.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    await reload();
  };

  const q = query.trim().toLowerCase();
  const shown = (items ?? []).filter(
    (s) => !q || [s.title, s.synopsis, s.keywords.join(" ")].join(" ").toLowerCase().includes(q),
  );

  return (
    <div className="page">
      <header className="page-head">
        <h2>{serial ? "連載の一覧" : anthology ? "短編集の一覧" : "物語の一覧"}</h2>
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
          {anthology && !serial && <p>短編集では、1話ずつガチャで概要を決めて、1話完結の短編を書いていきます。</p>}
          {serial && <p>カクヨム連載では、話(章)ごとに4回分の連載を書き、各回にサブタイトルを付けます。</p>}
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
                    title={
                      anthology
                        ? "設定(共通の登場人物・場所・品物、各話の仕込みなど)を引き継いで、新しく作り直します(元の作品は残ります)"
                        : "キーワードを修正して、ガチャからやり直す(元の物語は残ります)"
                    }
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
