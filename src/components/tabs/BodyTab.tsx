import { useEffect, useRef, useState } from "react";
import type { Story } from "../../types";
import type { Task } from "../../lib/pipeline";
import type { Mutate } from "../StoryDetail";
import { countChars } from "../../lib/text";
import { IssueList, isOpenIssue as isOpen, selectInTextarea } from "./IssueList";

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
  const locate = (text: string) => setNotice(selectInTextarea(editor.current, text));

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
          <button
            disabled={running || !ch.body}
            title="漢数字と算用数字の混在を、設定画面の「数字の表記」に合わせて統一します(すぐ終わります)"
            onClick={() => props.start({ kind: "numbers", index: ci })}
          >
            この章の数字を統一
          </button>
          {story.bible.characters.some((c) => c.bracket && c.bracket !== "「」") && (
            <button
              disabled={running || !ch.body}
              title="『』など決まった括弧で話す人物のセリフが、違う括弧で書かれていないかを点検して付け替えます"
              onClick={() => props.start({ kind: "brackets", index: ci })}
            >
              この章の括弧を点検
            </button>
          )}
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

        <IssueList
          title="整合性チェックの指摘"
          ci={ci}
          body={ch.body}
          items={ch.issues.map((it, i) => ({ it, i }))}
          running={running}
          mutate={mutate}
          locate={locate}
          notice={notice}
        />
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
