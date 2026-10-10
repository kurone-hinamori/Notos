import type { Story } from "../../types";
import type { Mutate } from "../StoryDetail";
import { Field, LinesField, Section } from "../ui";

export function OverviewTab({ story, mutate }: { story: Story; mutate: Mutate }) {
  return (
    <div className="stack">
      <Section title="基本情報">
        <Field label="タイトル" value={story.title} onChange={(v) => mutate((s) => void (s.title = v))} />
        <Field label="キャッチコピー" value={story.tagline} onChange={(v) => mutate((s) => void (s.tagline = v))} />
        <div className="two-col">
          <Field label="ジャンル" value={story.genre} onChange={(v) => mutate((s) => void (s.genre = v))} />
          <Field
            label="キーワード(読点区切り)"
            value={story.keywords.join("、")}
            onChange={(v) => mutate((s) => void (s.keywords = v.split(/[,、，]+/).map((k) => k.trim()).filter(Boolean)))}
          />
        </div>
        <Field
          label="補足の希望(ガチャ用。「複製してガチャからやり直す」で引き継がれます)"
          rows={2}
          value={story.note ?? ""}
          placeholder="例:主人公は女性、切ないが最後は救いのある結末に"
          onChange={(v) => mutate((s) => void (s.note = v))}
        />
        <Field label="あらすじ" rows={8} value={story.synopsis} onChange={(v) => mutate((s) => void (s.synopsis = v))} />
        <LinesField lines={story.lines ?? []} story={story} onChange={(lines) => mutate((s) => void (s.lines = lines))} />
      </Section>

      <Section
        title="登場人物(概要)"
        actions={
          <button
            className="small"
            onClick={() => mutate((s) => void s.characters.push({ name: "新しい人物", role: "", summary: "" }))}
          >
            ＋ 追加
          </button>
        }
      >
        {story.characters.map((c, i) => (
          <div key={i} className="entry">
            <div className="row">
              <input value={c.name} onChange={(e) => mutate((s) => void (s.characters[i].name = e.target.value))} placeholder="名前" />
              <input value={c.role} onChange={(e) => mutate((s) => void (s.characters[i].role = e.target.value))} placeholder="役割" />
              <button className="small danger" onClick={() => mutate((s) => void s.characters.splice(i, 1))}>
                削除
              </button>
            </div>
            <textarea rows={2} value={c.summary} onChange={(e) => mutate((s) => void (s.characters[i].summary = e.target.value))} />
          </div>
        ))}
        <p className="muted small-text">詳細な設定は「設定資料」タブで編集します。概要を変更した場合は、設定資料の再作成をおすすめします。</p>
      </Section>
    </div>
  );
}
