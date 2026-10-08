import type { CharacterSheet, Entry, Story } from "../../types";
import type { Task } from "../../lib/pipeline";
import type { Mutate } from "../StoryDetail";
import { Field, Section } from "../ui";

type EntryKey = "places" | "items" | "terms";

const CHARACTER_FIELDS: [keyof Story["bible"]["characters"][number], string, number][] = [
  ["reading", "読み", 0],
  ["role", "役割", 0],
  ["age", "年齢", 0],
  ["appearance", "外見", 2],
  ["personality", "性格", 2],
  ["speech", "口調・呼称", 2],
  ["background", "経歴", 3],
  ["relations", "関係", 2],
  ["notes", "本文で判明した追記", 2],
];

export function BibleTab(props: {
  story: Story;
  mutate: Mutate;
  start: (t: Task) => void;
  running: boolean;
  /** 短編集の話の場合:人物を共通の登場人物に登録する */
  onPromote?: (c: CharacterSheet) => void;
  /** 短編集の話の場合:共通の登場人物かどうか */
  isShared?: (name: string) => boolean;
}) {
  const { story, mutate, running } = props;
  const b = story.bible;

  if (!b.generated && b.characters.length === 0) {
    return (
      <div className="empty">
        <p>設定資料はまだありません。</p>
        <button className="primary" disabled={running} onClick={() => props.start({ kind: "bible" })}>
          設定資料を作成する
        </button>
      </div>
    );
  }

  const entrySection = (key: EntryKey, title: string) => (
    <Section
      title={title}
      actions={
        <button className="small" onClick={() => mutate((s) => void s.bible[key].push({ name: "新しい項目", description: "", notes: "" }))}>
          ＋ 追加
        </button>
      }
    >
      {b[key].map((e: Entry, i) => (
        <div key={i} className="entry">
          <div className="row">
            <input className="grow" value={e.name} onChange={(ev) => mutate((s) => void (s.bible[key][i].name = ev.target.value))} />
            <button className="small danger" onClick={() => mutate((s) => void s.bible[key].splice(i, 1))}>
              削除
            </button>
          </div>
          <textarea rows={2} value={e.description} onChange={(ev) => mutate((s) => void (s.bible[key][i].description = ev.target.value))} />
          {e.notes && (
            <label className="field">
              <span>本文で判明した追記</span>
              <textarea rows={2} value={e.notes} onChange={(ev) => mutate((s) => void (s.bible[key][i].notes = ev.target.value))} />
            </label>
          )}
        </div>
      ))}
      {b[key].length === 0 && <p className="muted">項目はありません。</p>}
    </Section>
  );

  return (
    <div className="stack">
      <p className="muted">
        設定資料は本文の執筆・校閲のたびに参照されます。ここでの編集は以降の執筆に反映されます(執筆済みの本文は自動では書き換わりません。「全章を校閲し直す」で矛盾を点検できます)。
      </p>
      <Section title="世界観・前提">
        <Field label="前提(核となる謎・対立・結末の方向性)" rows={3} value={b.premise} onChange={(v) => mutate((s) => void (s.bible.premise = v))} />
        <Field label="世界観" rows={5} value={b.worldview} onChange={(v) => mutate((s) => void (s.bible.worldview = v))} />
        <Field label="文体指針(視点・時制・トーン)" rows={3} value={b.style} onChange={(v) => mutate((s) => void (s.bible.style = v))} />
        <Field label="年表" rows={4} value={b.timeline} onChange={(v) => mutate((s) => void (s.bible.timeline = v))} />
      </Section>

      <Section
        title="登場人物"
        actions={
          <button
            className="small"
            onClick={() =>
              mutate((s) =>
                void s.bible.characters.push({ name: "新しい人物", reading: "", role: "", age: "", appearance: "", personality: "", speech: "", background: "", relations: "", notes: "" }),
              )
            }
          >
            ＋ 追加
          </button>
        }
      >
        {b.characters.map((c, i) => (
          <details key={i} className="entry" open={i < 2}>
            <summary>
              <strong>{c.name}</strong> <span className="muted">{c.role}</span>
              {props.isShared?.(c.name) ? (
                <span className="tag">共通の登場人物</span>
              ) : (
                props.onPromote && (
                  <button
                    className="small"
                    title="この人物を短編集の共通の登場人物にして、他の話にも同一人物として登場させられるようにします"
                    onClick={(e) => {
                      e.preventDefault();
                      props.onPromote?.(c);
                    }}
                  >
                    共通の登場人物に登録
                  </button>
                )
              )}
            </summary>
            <div className="row">
              <input className="grow" value={c.name} onChange={(e) => mutate((s) => void (s.bible.characters[i].name = e.target.value))} />
              <button className="small danger" onClick={() => mutate((s) => void s.bible.characters.splice(i, 1))}>
                削除
              </button>
            </div>
            {CHARACTER_FIELDS.map(([key, label, rows]) => (
              <Field
                key={key}
                label={label}
                rows={rows || undefined}
                value={c[key]}
                onChange={(v) => mutate((s) => void (s.bible.characters[i][key] = v))}
              />
            ))}
          </details>
        ))}
      </Section>

      {entrySection("places", "地名・場所")}
      {entrySection("items", "重要な品物")}
      {entrySection("terms", "用語・組織など")}
    </div>
  );
}
