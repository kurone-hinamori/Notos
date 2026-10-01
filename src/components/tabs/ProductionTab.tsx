import type { Story } from "../../types";
import type { RunState } from "../../hooks";
import type { Task } from "../../lib/pipeline";
import type { Mutate } from "../StoryDetail";
import { storyChars } from "../../lib/text";
import { Section } from "../ui";

function NumberField(props: { label: string; value: number; min: number; max: number; step?: number; disabled?: boolean; onChange: (n: number) => void }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Math.min(props.max, Math.max(props.min, Number(e.target.value) || props.min)))}
      />
    </label>
  );
}

export function ProductionTab(props: {
  story: Story;
  run: RunState;
  mutate: Mutate;
  start: (t: Task) => void;
  stop: () => void;
  disabled: boolean;
}) {
  const { story, run, mutate } = props;
  const running = run.running && run.storyId === story.id;
  const mine = run.storyId === story.id;
  const { plan } = story;
  const total = plan.chapters * plan.scenes * plan.charsPerScene;
  const written = story.chapters.filter((c) => c.sceneDone >= c.beats.length && c.beats.length > 0).length;
  const proofread = story.chapters.filter((c) => c.proofread).length;
  const hasStarted = story.bible.generated || story.chapters.length > 0;
  const locked = running || props.disabled;

  const steps: [string, boolean, string][] = [
    ["設定資料", story.bible.generated, story.bible.generated ? "作成済み" : "未作成"],
    ["章構成", story.chapters.length > 0, story.chapters.length ? `${story.chapters.length}章` : "未作成"],
    ["本文の執筆", story.chapters.length > 0 && written === story.chapters.length, story.chapters.length ? `${written}/${story.chapters.length}章` : "-"],
    ["校閲・整合性チェック", story.chapters.length > 0 && proofread === story.chapters.length, story.chapters.length ? `${proofread}/${story.chapters.length}章` : "-"],
  ];

  return (
    <div className="stack">
      <Section title="本の規模">
        <div className="three-col">
          <NumberField label="章の数" value={plan.chapters} min={3} max={30} disabled={locked} onChange={(n) => mutate((s) => void (s.plan.chapters = n))} />
          <NumberField label="1章あたりの場面数" value={plan.scenes} min={2} max={8} disabled={locked} onChange={(n) => mutate((s) => void (s.plan.scenes = n))} />
          <NumberField label="1場面の文字数(目安)" value={plan.charsPerScene} min={600} max={4000} step={100} disabled={locked} onChange={(n) => mutate((s) => void (s.plan.charsPerScene = n))} />
        </div>
        <p className="muted">
          目標の長さ:約 {total.toLocaleString()} 字(文庫本1冊は約8〜10万字)。現在 {storyChars(story).toLocaleString()} 字。
          章の数と場面数は、次に章構成を作成(作り直し)するときに反映されます。
        </p>
      </Section>

      <Section
        title="自動執筆"
        actions={
          running ? (
            <button className="danger" onClick={props.stop}>
              ■ 停止
            </button>
          ) : (
            <button className="primary" disabled={props.disabled} onClick={() => props.start({ kind: "all" })}>
              {story.status === "done" ? "▶ 未処理の工程を実行" : hasStarted ? "▶ 続きから再開" : "▶ 本文の作成を始める"}
            </button>
          )
        }
      >
        <ol className="steps">
          {steps.map(([label, ok, note]) => (
            <li key={label} className={ok ? "ok" : ""}>
              <span className="mark">{ok ? "✔" : "○"}</span>
              <span>{label}</span>
              <span className="muted small-text">{note}</span>
            </li>
          ))}
        </ol>
        <p className="muted small-text">
          設定資料 → 章構成 → 場面ごとの執筆(章ごとに設定資料へ反映)→ 校閲・整合性チェックの順に進みます。1冊分の生成には長い時間がかかります。途中で停止しても、進捗は保存され続きから再開できます。
        </p>

        {mine && run.error && <p className="error">エラー:{run.error}</p>}
        {mine && running && (
          <div className="live">
            <div className="running">● {run.stage}</div>
            <pre className="stream">{run.stream.slice(-1200)}</pre>
          </div>
        )}
        {mine && run.logs.length > 0 && (
          <details open={!running}>
            <summary>ログ</summary>
            <ul className="log">
              {run.logs
                .slice()
                .reverse()
                .map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
            </ul>
          </details>
        )}
      </Section>

      <Section title="個別の操作">
        <div className="row wrap">
          <button disabled={locked} onClick={() => confirmThen(story.bible.generated, "設定資料を作り直します(手動の編集内容は失われます)。", () => props.start({ kind: "bible" }))}>
            設定資料を{story.bible.generated ? "作り直す" : "作成"}
          </button>
          <button
            disabled={locked || !story.bible.generated}
            onClick={() => confirmThen(story.chapters.length > 0, "章構成を作り直します。既存の本文はすべて失われます。", () => props.start({ kind: "outline" }))}
          >
            章構成を{story.chapters.length ? "作り直す" : "作成"}
          </button>
          <button disabled={locked || written === 0} onClick={() => props.start({ kind: "proofread", index: "all" })}>
            全章を校閲し直す
          </button>
        </div>
        <p className="muted small-text">章ごとの再生成・校閲は「本文」タブから行えます。</p>
      </Section>
    </div>
  );
}

function confirmThen(needed: boolean, message: string, run: () => void) {
  if (!needed || window.confirm(message)) run();
}
