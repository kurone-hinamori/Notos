import { useEffect, useState } from "react";
import type { Story } from "../../types";
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
            <h3>整合性チェックの指摘</h3>
            <ul className="issues">
              {ch.issues.map((it, i) => (
                <li key={i} className={it.applied ? "applied" : ""}>
                  <span className="badge">{it.applied ? "修正済み" : "要確認"}</span>
                  <div>
                    <div>{it.problem}</div>
                    <div className="quote">「{it.quote}」</div>
                    {it.replacement && !it.applied && <div className="muted small-text">修正案:{it.replacement}</div>}
                    {it.replacement && it.applied && (
                      <div className="muted small-text">
                        → {it.replacement}{" "}
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
                      </div>
                    )}
                  </div>
                </li>
              ))}
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
