import { useEffect, useRef, useState } from "react";
import type { Issue, Story } from "../../types";
import type { Task } from "../../lib/pipeline";
import type { Mutate } from "../StoryDetail";
import { countChars } from "../../lib/text";

export function BodyTab(props: { story: Story; mutate: Mutate; start: (t: Task) => void; running: boolean }) {
  const { story, mutate, running } = props;
  const [index, setIndex] = useState(0);
  const ci = Math.min(index, Math.max(0, story.chapters.length - 1));
  const ch = story.chapters[ci];

  // 章を切り替えたら、ページ全体のスクロールを先頭に戻す(本文欄は key で作り直されて先頭になる)
  useEffect(() => {
    document.querySelector(".main")?.scrollTo({ top: 0 });
  }, [ci]);

  const editor = useRef<HTMLTextAreaElement>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => setNotice(""), [ci]);

  /** 本文中の該当箇所を選択し、見える位置までスクロールする */
  const locate = (text: string) => {
    const ta = editor.current;
    if (!ta || !ch) return;
    const hit = findInBody(ch.body, text);
    if (!hit) {
      setNotice("本文中に該当箇所が見つかりませんでした(引用が本文と一致していません)。指摘の内容を手がかりに探してください。");
      return;
    }
    setNotice(hit.exact ? "" : "引用が本文と完全には一致しないため、近い箇所を表示しています。");
    // 該当箇所までの高さを測って、入力欄の中をスクロールする
    const full = ta.value;
    ta.value = full.slice(0, hit.start);
    const y = ta.scrollHeight;
    ta.value = full;
    ta.scrollIntoView({ block: "center" });
    ta.focus();
    ta.setSelectionRange(hit.start, hit.end);
    ta.scrollTop = Math.max(0, y - ta.clientHeight / 2);
  };

  const setState = (i: number, state: Issue["state"]) =>
    mutate((s) => {
      const it = s.chapters[ci].issues[i];
      if (state) it.state = state;
      else delete it.state;
    });

  const isOpen = (it: Issue) => !it.applied && !it.state;
  const open = ch ? ch.issues.filter(isOpen) : [];

  if (!ch) {
    return <p className="muted">まだ本文がありません。「制作」タブから作成を始めてください。</p>;
  }

  return (
    <div className="editor">
      <aside className="chapter-list">
        {story.chapters.map((c, i) => (
          <button key={i} className={i === ci ? "active" : ""} onClick={() => setIndex(i)}>
            <span>
              第{i + 1}章 {c.title}
            </span>
            <small className="muted">
              {countChars(c.body).toLocaleString()}字
              {c.sceneDone < c.beats.length ? " ・執筆中" : c.proofread ? " ・校閲済" : ""}
              {c.issues.some(isOpen) && <span className="error"> ・要確認 {c.issues.filter(isOpen).length}</span>}
            </small>
          </button>
        ))}
      </aside>

      <div className="stack grow">
        <div className="row">
          <input className="grow" value={ch.title} onChange={(e) => mutate((s) => void (s.chapters[ci].title = e.target.value))} />
          <button
            disabled={running}
            onClick={() => window.confirm(`第${ci + 1}章を最初から書き直します。現在の本文は失われます。`) && props.start({ kind: "chapter", index: ci })}
          >
            この章を再生成
          </button>
          <button disabled={running || !ch.body} onClick={() => props.start({ kind: "proofread", index: ci })}>
            この章を校閲
          </button>
        </div>

        <details>
          <summary>章のあらすじと場面構成</summary>
          <textarea rows={3} value={ch.plan} onChange={(e) => mutate((s) => void (s.chapters[ci].plan = e.target.value))} />
          <ol className="beats">
            {ch.beats.map((b, i) => (
              <li key={i}>
                <textarea rows={2} value={b} onChange={(e) => mutate((s) => void (s.chapters[ci].beats[i] = e.target.value))} />
              </li>
            ))}
          </ol>
        </details>

        <textarea
          key={ci}
          ref={editor}
          className="body-editor"
          value={ch.body}
          placeholder="(この章の本文はまだありません)"
          onChange={(e) =>
            mutate((s) => {
              s.chapters[ci].body = e.target.value;
              s.chapters[ci].proofread = false;
            })
          }
        />
        <small className="muted">
          {countChars(ch.body).toLocaleString()}字。空行は場面転換として扱われます。手動で編集した内容は自動保存されます。
        </small>

        {ch.issues.length > 0 && (
          <section className="card">
            <div className="card-head">
              <h3>整合性チェックの指摘</h3>
              <span className="muted small-text">
                要確認 {open.length}件 / 全{ch.issues.length}件
              </span>
            </div>
            <p className="muted small-text">
              「要確認」は自動では直せなかった指摘です。内容を確認し、必要なら本文を直してください(誤検出の場合は「無視する」で構いません)。
            </p>
            {notice && <p className="error">{notice}</p>}
            <ul className="issues">
              {ch.issues.map((it, i) => {
                const closed = it.state !== undefined;
                const label = it.state === "done" ? "対応済み" : it.state === "ignored" ? "無視" : it.applied ? "修正済み" : "要確認";
                const count = it.replacement && !it.applied ? ch.body.split(it.quote).length - 1 : 0;
                return (
                  <li key={i} className={closed ? "closed" : it.applied ? "applied" : ""}>
                    <span className="badge">{label}</span>
                    <div className="grow">
                      <div>{it.problem}</div>
                      {it.quote && <div className="quote">「{it.quote}」</div>}
                      {it.replacement && <div className="muted small-text">{it.applied ? "→ " : "修正案:"}{it.replacement}</div>}
                      <div className="row wrap issue-actions">
                        {it.quote && (
                          <button className="small" onClick={() => locate(it.applied ? it.replacement : it.quote)}>
                            本文で表示
                          </button>
                        )}
                        {it.applied && (
                          <button
                            className="small"
                            disabled={running}
                            onClick={() =>
                              mutate((s) => {
                                const c = s.chapters[ci];
                                if (c.body.split(it.replacement).length === 2) c.body = c.body.replace(it.replacement, () => it.quote);
                                c.issues[i].applied = false;
                              })
                            }
                          >
                            元に戻す
                          </button>
                        )}
                        {!it.applied && !closed && it.replacement && (
                          <button
                            className="small"
                            disabled={running || count === 0}
                            title={count === 0 ? "引用が本文と一致しないため、自動では適用できません。本文を直接直してください。" : ""}
                            onClick={() => {
                              if (count > 1 && !window.confirm(`同じ文が${count}箇所あります。最初の箇所に適用しますか?`)) return;
                              mutate((s) => {
                                const c = s.chapters[ci];
                                c.body = c.body.replace(it.quote, () => it.replacement);
                                c.issues[i].applied = true;
                              });
                            }}
                          >
                            この修正案を適用
                          </button>
                        )}
                        {!it.applied && !closed && (
                          <>
                            <button className="small" onClick={() => setState(i, "done")}>
                              対応済みにする
                            </button>
                            <button className="small" onClick={() => setState(i, "ignored")}>
                              無視する
                            </button>
                          </>
                        )}
                        {closed && (
                          <button className="small" onClick={() => setState(i, undefined)}>
                            要確認に戻す
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {ch.digest && (
          <details>
            <summary>この章の要約(次章以降の執筆で参照されます)</summary>
            <textarea rows={4} value={ch.digest} onChange={(e) => mutate((s) => void (s.chapters[ci].digest = e.target.value))} />
          </details>
        )}
      </div>
    </div>
  );
}

/**
 * 本文から引用箇所を探す。LLM の引用は本文と一字一句は一致しないことがあるので、
 * 見つからなければ、引用の一部が一致する近い箇所を探す。
 */
function findInBody(body: string, text: string): { start: number; end: number; exact: boolean } | null {
  const q = text.trim();
  if (!q) return null;
  const at = body.indexOf(q);
  if (at >= 0) return { start: at, end: at + q.length, exact: true };
  // 引用の中で、本文と一致する最も長い部分(5文字以上)を探す
  for (let len = Math.min(q.length - 1, 24); len >= 5; len--) {
    for (let from = 0; from + len <= q.length; from++) {
      const part = q.slice(from, from + len);
      const i = body.indexOf(part);
      if (i >= 0) return { start: i, end: i + part.length, exact: false };
    }
  }
  return null;
}
