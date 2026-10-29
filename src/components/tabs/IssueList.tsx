import type { Issue } from "../../types";
import type { Mutate } from "../StoryDetail";

export const isOpenIssue = (it: Issue) => !it.applied && !it.state;

/** 整合性チェックの指摘の一覧。items の i は章の issues の中での位置 */
export function IssueList(props: {
  title: string;
  ci: number;
  /** 章全体の本文(修正案の適用は章の本文に対して行う) */
  body: string;
  items: { it: Issue; i: number }[];
  running: boolean;
  mutate: Mutate;
  locate: (text: string) => void;
  notice?: string;
}) {
  const { ci, body, items, running, mutate } = props;
  const open = items.filter(({ it }) => isOpenIssue(it));

  const setState = (i: number, state: Issue["state"]) =>
    mutate((s) => {
      const it = s.chapters[ci].issues[i];
      if (state) it.state = state;
      else delete it.state;
    });

  if (!items.length) return null;
  return (
    <section className="card">
      <div className="card-head">
        <h3>{props.title}</h3>
        <span className="muted small-text">
          要確認 {open.length}件 / 全{items.length}件
        </span>
      </div>
      <p className="muted small-text">
        「要確認」は自動では直せなかった指摘です。内容を確認し、必要なら本文を直してください(誤検出の場合は「無視する」で構いません)。
      </p>
      {props.notice && <p className="error">{props.notice}</p>}
      <ul className="issues">
        {items.map(({ it, i }) => {
          const closed = it.state !== undefined;
          const label = it.state === "done" ? "対応済み" : it.state === "ignored" ? "無視" : it.applied ? "修正済み" : "要確認";
          const count = it.replacement && !it.applied ? body.split(it.quote).length - 1 : 0;
          return (
            <li key={i} className={closed ? "closed" : it.applied ? "applied" : ""}>
              <span className="badge">{label}</span>
              <div className="grow">
                <div>{it.problem}</div>
                {it.quote && <div className="quote">「{it.quote}」</div>}
                {it.replacement && <div className="muted small-text">{it.applied ? "→ " : "修正案:"}{it.replacement}</div>}
                <div className="row wrap issue-actions">
                  {it.quote && (
                    <button className="small" onClick={() => props.locate(it.applied ? it.replacement : it.quote)}>
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
  );
}

/**
 * 本文から引用箇所を探す。LLM の引用は本文と一字一句は一致しないことがあるので、
 * 見つからなければ、引用の一部が一致する近い箇所を探す。
 */
export function findInBody(body: string, text: string): { start: number; end: number; exact: boolean } | null {
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

/** 入力欄の中の該当箇所を選択し、見える位置までスクロールする。見つからなければメッセージを返す */
export function selectInTextarea(ta: HTMLTextAreaElement | null, text: string): string {
  if (!ta) return "";
  const hit = findInBody(ta.value, text);
  if (!hit) return "本文中に該当箇所が見つかりませんでした(引用が本文と一致していません)。指摘の内容を手がかりに探してください。";
  // 該当箇所までの高さを測って、入力欄の中をスクロールする
  const full = ta.value;
  ta.value = full.slice(0, hit.start);
  const y = ta.scrollHeight;
  ta.value = full;
  ta.scrollIntoView({ block: "center" });
  ta.focus();
  ta.setSelectionRange(hit.start, hit.end);
  ta.scrollTop = Math.max(0, y - ta.clientHeight / 2);
  return hit.exact ? "" : "引用が本文と完全には一致しないため、近い箇所を表示しています。";
}
