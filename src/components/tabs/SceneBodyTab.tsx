import { useEffect, useRef, useState } from "react";
import type { Issue, Story } from "../../types";
import type { Task } from "../../lib/pipeline";
import { sceneProofreadOf } from "../../lib/pipeline";
import type { Mutate } from "../StoryDetail";
import { countChars, splitScenes } from "../../lib/text";
import { IssueList, isOpenIssue, selectInTextarea } from "./IssueList";

/** 指摘がどの場面のものか。場面ごとに校閲する前の指摘は、引用の場所から決める(見つからなければ -1) */
function sceneOfIssue(it: Issue, scenes: string[]): number {
  if (it.scene !== undefined) return it.scene;
  const q = it.applied ? it.replacement : it.quote;
  return q ? scenes.findIndex((s) => s.includes(q)) : -1;
}

/** 短編集・連載の話の本文。場面ごとに表示・編集し、場面ごとに書き直し・校閲する */
export function SceneBodyTab(props: {
  story: Story;
  mutate: Mutate;
  start: (t: Task) => void;
  running: boolean;
  /** カクヨム連載:場面(=連載1回分)にサブタイトルを付ける */
  serial?: boolean;
}) {
  const { story, mutate, running, serial } = props;
  const ci = 0;
  const ch = story.chapters[ci];
  const scenes = ch ? splitScenes(ch.body) : [];
  const count = ch ? Math.max(ch.beats.length, scenes.length) : 0;
  const [index, setIndex] = useState(0);
  const si = Math.min(index, Math.max(0, count - 1));
  const text = scenes[si] ?? "";
  const written = si < scenes.length;

  // 入力中の改行などを失わないよう、入力欄は手元の下書きを表示し、本文が外から変わったときだけ合わせる
  const [draft, setDraft] = useState(text);
  useEffect(() => {
    if (draft.trim() !== text) setDraft(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, si]);

  // 場面を切り替えたら、ページ全体のスクロールを先頭に戻す
  useEffect(() => {
    document.querySelector(".main")?.scrollTo({ top: 0 });
  }, [si]);

  const editor = useRef<HTMLTextAreaElement>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => setNotice(""), [si]);
  const locate = (q: string) => setNotice(selectInTextarea(editor.current, q));

  if (!ch) {
    return <p className="muted">まだ本文がありません。「制作」タブから作成を始めてください。</p>;
  }

  const done = sceneProofreadOf(ch);
  const all = ch.issues.map((it, i) => ({ it, i, at: sceneOfIssue(it, scenes) }));
  const openIn = (k: number) => all.filter((x) => x.at === k && isOpenIssue(x.it)).length;
  const here = all.filter((x) => x.at === si);
  const unplaced = all.filter((x) => x.at < 0);
  const hasBrackets = story.bible.characters.some((c) => c.bracket && c.bracket !== "「」");
  const sceneTitle = (k: number) => (serial ? ch.sceneTitles?.[k] : "") || ch.beats[k]?.slice(0, 24) || "";

  const edit = (value: string) => {
    // 場面の中には空行を入れない(空行は場面の区切りなので、入れると場面が分かれてしまう)
    const v = value.replace(/\n[ \t　]*\n/g, "\n");
    setDraft(v);
    if (!v.trim()) return;
    mutate((s) => {
      const c = s.chapters[ci];
      const list = splitScenes(c.body);
      list[si] = v;
      c.body = list.join("\n\n");
      const d = sceneProofreadOf(c);
      d[si] = false;
      c.sceneProofread = d;
      c.proofread = false;
    });
  };

  return (
    <div className="editor">
      <aside className="chapter-list">
        {Array.from({ length: count }, (_, k) => (
          <button key={k} className={k === si ? "active" : ""} onClick={() => setIndex(k)}>
            <span>
              {serial ? `${k + 1}回目` : `場面${k + 1}`} <span className="muted small-text">{sceneTitle(k)}</span>
            </span>
            <small className="muted">
              {k < scenes.length ? `${countChars(scenes[k]).toLocaleString()}字` : "未執筆"}
              {k < scenes.length && done[k] ? " ・校閲済" : ""}
              {openIn(k) > 0 && <span className="error"> ・要確認 {openIn(k)}</span>}
            </small>
          </button>
        ))}
      </aside>

      <div className="stack grow">
        <div className="row wrap">
          {serial ? (
            <input
              className="grow"
              value={ch.sceneTitles?.[si] ?? ""}
              placeholder="サブタイトル"
              onChange={(e) =>
                mutate((s) => {
                  const c = s.chapters[ci];
                  const titles = [...(c.sceneTitles ?? [])];
                  titles[si] = e.target.value;
                  c.sceneTitles = titles;
                })
              }
            />
          ) : (
            <strong className="grow">場面{si + 1}</strong>
          )}
          <button
            disabled={running || !written}
            title={written ? "前後の場面はそのままで、この場面だけを書き直します" : "まだ執筆していない場面です。「制作」タブから執筆を進めてください"}
            onClick={() => window.confirm(`場面${si + 1}を書き直します。この場面の現在の本文は失われます。`) && props.start({ kind: "scene", index: ci, scene: si })}
          >
            この場面を再生成
          </button>
          <button disabled={running || !written} onClick={() => props.start({ kind: "proofread", index: ci, scene: si })}>
            この場面を校閲
          </button>
          <button
            disabled={running || !written}
            title="漢数字と算用数字の混在を、設定画面の「数字の表記」に合わせて統一します(すぐ終わります)"
            onClick={() => props.start({ kind: "numbers", index: ci, scene: si })}
          >
            数字を統一
          </button>
          {hasBrackets && (
            <button
              disabled={running || !written}
              title="『』など決まった括弧で話す人物のセリフが、違う括弧で書かれていないかを点検して付け替えます"
              onClick={() => props.start({ kind: "brackets", index: ci, scene: si })}
            >
              括弧を点検
            </button>
          )}
        </div>

        <details>
          <summary>この場面の展開(構成)</summary>
          <textarea
            rows={3}
            value={ch.beats[si] ?? ""}
            onChange={(e) => mutate((s) => void (s.chapters[ci].beats[si] = e.target.value))}
          />
          {(ch.lines ?? []).some((l) => l.scene === si) && (
            <p className="muted small-text">
              この場面で使うセリフ:{(ch.lines ?? []).filter((l) => l.scene === si).map((l) => l.text).join(" / ")}
            </p>
          )}
        </details>

        <textarea
          key={si}
          ref={editor}
          className="body-editor"
          value={draft}
          disabled={!written}
          placeholder="(この場面はまだ執筆していません。「制作」タブから執筆を進めてください)"
          onChange={(e) => edit(e.target.value)}
        />
        <small className="muted">
          {countChars(draft).toLocaleString()}字。手動で編集した内容は自動保存されます(場面の中に空行は入れられません)。
        </small>

        <IssueList
          title="この場面の整合性チェックの指摘"
          ci={ci}
          body={ch.body}
          items={here}
          running={running}
          mutate={mutate}
          locate={locate}
          notice={notice}
        />
        <IssueList
          title="場面を特定できない指摘"
          ci={ci}
          body={ch.body}
          items={unplaced}
          running={running}
          mutate={mutate}
          locate={locate}
        />
      </div>
    </div>
  );
}
