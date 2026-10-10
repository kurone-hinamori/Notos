import { useEffect, useState } from "react";
import type { Anthology, AnthologyMode, CharacterSheet, Concept, Entry, EntryKind, Settings, SharedCharacter, Story } from "../types";
import type { Job, RunState } from "../hooks";
import type { Task } from "../lib/pipeline";
import { createEpisode, isUndecided } from "../lib/storage";
import { anthologyBook } from "../lib/epub";
import { countChars, storyChars } from "../lib/text";
import { ConceptGacha, cleanKeywords, initialGacha, type GachaState } from "./ConceptGacha";
import { ArtTab, type Mutate } from "./StoryDetail";
import { OverviewTab } from "./tabs/OverviewTab";
import { ProductionTab } from "./tabs/ProductionTab";
import { BodyTab } from "./tabs/BodyTab";
import { BibleTab } from "./tabs/BibleTab";
import { ExportTab } from "./tabs/ExportTab";
import { Field, Section } from "./ui";
import { CastEditor } from "./CastEditor";
import {
  applyConcept,
  castOf,
  clearHistory,
  isSeries,
  resetEpisode,
  sharedContextFor,
  sharedEntries,
  toShared,
  toSharedEntry,
} from "../lib/anthology";
import { SharedEntriesEditor } from "./SharedEntriesEditor";
import { parseLines, sameName } from "../lib/text";

/** 短編集の種類の選択 */
export function ModeSelect(props: { mode: AnthologyMode; onChange: (m: AnthologyMode) => void }) {
  const options: [AnthologyMode, string, string][] = [
    ["series", "連作短編", "共通の登場人物・世界観で、話の順に時間が進みます。前の話で起きたことが後の話に引き継がれます。"],
    ["omnibus", "オムニバス", "各話が独立した物語です。共通の登場人物を出すことはできますが、話をまたいだ経緯は引き継ぎません。"],
  ];
  return (
    <div className="stack">
      {options.map(([value, label, desc]) => (
        <label key={value} className="check">
          <input type="radio" checked={props.mode === value} onChange={() => props.onChange(value)} />
          <span>
            <strong>{label}</strong> <span className="muted small-text">{desc}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

type MutateAnthology = (m: (draft: Anthology) => void) => void;

const TABS = [
  ["episodes", "話の一覧と制作"],
  ["info", "短編集の情報"],
  ["art", "表紙・挿絵"],
  ["export", "EPUB出力"],
] as const;
type TabId = (typeof TABS)[number][0];

const REBUILD_CONCEPT_QUESTION =
  "あらすじも作り直しますか?\n\n" +
  "[OK] あらすじから作り直す(前の話の内容を踏まえて、あらすじを自動で作り直します)\n" +
  "[キャンセル] あらすじは今のまま、設定資料・構成・本文だけを作り直す";

function episodeStatus(e: Story): string {
  if (isUndecided(e)) return "未決定";
  if (e.status === "done") return "完成";
  if (e.bible.generated || e.chapters.length) return "執筆中";
  return "概要決定";
}

const conceptOf = (e: Story): Concept => ({
  title: e.title,
  tagline: e.tagline,
  genre: e.genre,
  synopsis: e.synopsis,
  characters: e.characters,
});

export function AnthologyDetail(props: {
  anthology: Anthology;
  settings: Settings;
  run: RunState;
  mutate: MutateAnthology;
  start: (t: Task, episode: number) => void;
  execute: (jobs: Job[]) => void;
  stop: () => void;
  onBack: () => void;
}) {
  const { anthology: a, run, mutate } = props;
  const [tab, setTab] = useState<TabId>("episodes");
  const [selected, setSelected] = useState(() => Math.max(0, a.episodes.findIndex((e) => e.status !== "done")));
  // 話ごとのガチャの状態(話を切り替えても、引いた案や引いている最中の結果を失わないようにここで持つ)
  const [gachas, setGachas] = useState<Record<string, GachaState>>({});

  const mine = run.docId === a.id;
  const runningHere = run.running && mine;
  const busyElsewhere = run.running && !mine;
  const index = Math.min(selected, a.episodes.length - 1);
  const ep = a.episodes[index];
  const decided = a.episodes.filter((e) => !isUndecided(e));
  // おまかせ:概要が未決定の話も、直前までの話を踏まえてあらすじを自動で作ってから生成する
  const auto = a.autoConcept ?? true;
  const pending = a.episodes.map((e, i) => ({ e, i })).filter(({ e }) => e.status !== "done" && (auto || !isUndecided(e)));
  const totalChars = a.episodes.reduce((n, e) => n + storyChars(e), 0);

  // ガチャの初期値は、話に保存してある「仕込み」(タイトル・キーワード・補足・セリフ)から作る
  const initialFor = (e: Story | undefined) =>
    initialGacha(e?.keywords ?? a.keywords, e?.note ?? a.note, undefined, { title: e?.plannedTitle, lines: e?.lines });
  const gachaFor = (e: Story) => gachas[e.id] ?? initialFor(e);
  const updateGacha = (id: string) => (fn: (s: GachaState) => GachaState) =>
    setGachas((g) => ({ ...g, [id]: fn(g[id] ?? initialFor(a.episodes.find((e) => e.id === id))) }));

  const mutateEpisode =
    (i: number): Mutate =>
    (m) =>
      mutate((d) => m(d.episodes[i]));

  const addEpisode = () => {
    mutate((d) => void d.episodes.push(createEpisode(d)));
    setSelected(a.episodes.length);
  };

  const removeEpisode = (i: number) => {
    const e = a.episodes[i];
    if (!window.confirm(`第${i + 1}話${e.title ? `「${e.title}」` : ""}を削除します。元に戻せません。よろしいですか?`)) return;
    mutate((d) => void d.episodes.splice(i, 1));
    setSelected(Math.max(0, Math.min(i, a.episodes.length - 2)));
  };

  /** 概要を未決定に戻し、今の案を【元の案】としてガチャをやり直す。 */
  const redoEpisode = (i: number) => {
    const e = a.episodes[i];
    const hasWork = e.bible.generated || e.chapters.length > 0;
    if (hasWork && !window.confirm(`第${i + 1}話の設定資料と本文を破棄して、ガチャからやり直します。よろしいですか?`)) return;
    setGachas((g) => ({
      ...g,
      [e.id]: initialGacha(e.keywords, e.note ?? "", conceptOf(e), { title: e.plannedTitle, lines: e.lines }),
    }));
    mutate((d) => {
      resetEpisode(d.episodes[i], true);
      clearHistory(d, [e.id]);
    });
  };

  /**
   * i 番目の話から後ろを、最新の共通設定と経緯で作り直す。
   * 前の話の「要確認」を直した後に、その内容を後の話へ反映させるために使う。
   */
  const rebuildFrom = (i: number) => {
    const count = a.episodes.length - i;
    if (!window.confirm(`第${i + 1}話から最後まで(${count}話)の設定資料・構成・本文を破棄して、順に作り直します。よろしいですか?`)) return;
    const concept = window.confirm(REBUILD_CONCEPT_QUESTION);
    const ids = a.episodes.slice(i).map((e) => e.id);
    setGachas((g) => Object.fromEntries(Object.entries(g).filter(([id]) => !ids.includes(id))));
    mutate((d) => {
      d.episodes.slice(i).forEach((e) => resetEpisode(e, concept));
      clearHistory(d, ids);
    });
    props.execute(
      a.episodes
        .map((e, k) => ({ e, k }))
        .filter(({ e, k }) => k >= i && (concept || auto || !isUndecided(e)))
        .map(({ k }) => ({ episode: k, task: { kind: "all" as const }, auto: concept || auto })),
    );
  };

  /** 設定資料の場所・品物・用語を共通の設定にする */
  const promoteEntry = (kind: EntryKind, e: Entry) =>
    mutate((d) => {
      d.shared ??= {};
      const list = (d.shared[kind] ??= []);
      if (!list.some((x) => sameName(x.name, e.name))) list.push(toSharedEntry(e));
    });

  /** 設定資料の人物を共通の登場人物にし、この話の出演者にする */
  const promote = (i: number, c: CharacterSheet) =>
    mutate((d) => {
      d.cast ??= [];
      let hit = d.cast.find((x) => sameName(x.name, c.name));
      if (!hit) {
        hit = toShared(c);
        d.cast.push(hit);
      }
      const e = d.episodes[i];
      e.castIds = [...new Set([...(e.castIds ?? []), hit.id])];
    });

  const setCastIds = (i: number, ids: string[]) => mutate((d) => void (d.episodes[i].castIds = ids));

  const decide = (i: number, c: Concept, keywords: string[], note: string, lines: string[]) =>
    mutate((d) => applyConcept(d.episodes[i], c, keywords, note, lines));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <button className="link" onClick={props.onBack}>
            ← 短編集の一覧へ
          </button>
          <h2>
            {a.title || "(無題の短編集)"} <span className="badge">短編集</span>
          </h2>
          <span className="muted small-text">
            全{a.episodes.length}話(概要決定 {decided.length} / 完成 {a.episodes.filter((e) => e.status === "done").length})・
            {totalChars.toLocaleString()}字
          </span>
        </div>
        {runningHere && <span className="running">● 生成中:{run.stage}</span>}
      </header>

      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {busyElsewhere && <p className="notice">別の物語を生成中のため、生成は開始できません。</p>}

      {tab === "episodes" && (
        <div className="stack">
          <Section
            title="まとめて自動生成"
            actions={
              runningHere ? (
                <button className="danger" onClick={props.stop}>
                  ■ 停止
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={run.running || pending.length === 0}
                  onClick={() => props.execute(pending.map(({ i }) => ({ episode: i, task: { kind: "all" }, auto })))}
                >
                  ▶ 未完成の話をすべて生成({pending.length}話)
                </button>
              )
            }
          >
            <p className="muted small-text">
              未完成の話を、第1話から順に「設定資料 → 構成 → 執筆 → 校閲」まで生成します。各話はその話の設定資料と共通の設定だけを参照します。
              {isSeries(a) && "連作短編では、1話を書き終えるたびに共通の設定の経緯を更新し、次の話に引き継ぎます。"}
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={auto}
                disabled={runningHere}
                onChange={(e) => mutate((d) => void (d.autoConcept = e.target.checked))}
              />
              <span>
                <strong>おまかせ</strong>:概要が未決定の話は、あらすじも自動で作る
                <span className="muted small-text">
                  (直前の話が書き上がってから作るので、前の話の内容があらすじに反映されます。各話のタイトル・キーワード・セリフ・出演者だけ先に入れておけます)
                </span>
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={a.stopOnIssues ?? false}
                disabled={runningHere}
                onChange={(e) => mutate((d) => void (d.stopOnIssues = e.target.checked))}
              />
              <span>
                「要確認」の指摘が残った話があれば、次の話へ進まずに止まる
                <span className="muted small-text">(オフの場合は最後まで生成します。後から直す場合は、各話の「この話以降を作り直す」が使えます)</span>
              </span>
            </label>
            {mine && run.error && <p className="error">エラー:{run.error}</p>}
            {mine && run.logs.length > 0 && (
              <details open={runningHere}>
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

          <div className="editor">
            <aside className="chapter-list">
              {a.episodes.map((e, i) => (
                <button key={e.id} className={i === index ? "active" : ""} onClick={() => setSelected(i)}>
                  <span>
                    第{i + 1}話 {e.title || <span className="muted">(未決定)</span>}
                  </span>
                  <small className="muted">
                    {run.running && run.storyId === e.id ? "● 生成中" : episodeStatus(e)}
                    {e.chapters.length ? ` ・${countChars(e.chapters.map((c) => c.body).join("")).toLocaleString()}字` : ""}
                  </small>
                </button>
              ))}
              <button disabled={runningHere} onClick={addEpisode}>
                ＋ 話を追加
              </button>
            </aside>

            {ep && (
              <EpisodePanel
                key={ep.id}
                anthology={a}
                index={index}
                episode={ep}
                settings={props.settings}
                run={run}
                gacha={gachaFor(ep)}
                updateGacha={updateGacha(ep.id)}
                mutate={mutateEpisode(index)}
                start={(t) => props.start(t, index)}
                stop={props.stop}
                structureLocked={runningHere}
                onDecide={(c, kws, note, lines) => decide(index, c, kws, note, lines)}
                onRebuildFrom={() => rebuildFrom(index)}
                onUpdateHistory={() => props.execute([{ episode: index, task: { kind: "all" }, historyOnly: true }])}
                onPromoteEntry={promoteEntry}
                onRedo={() => redoEpisode(index)}
                onRemove={() => removeEpisode(index)}
                onPromote={(c) => promote(index, c)}
                onCastIds={(ids) => setCastIds(index, ids)}
              />
            )}
          </div>
        </div>
      )}

      {tab === "info" && <InfoTab anthology={a} mutate={mutate} settings={props.settings} />}
      {tab === "art" && <ArtTab />}
      {tab === "export" && (
        <ExportTab
          title={a.title}
          author={a.author}
          defaultAuthor={props.settings.author}
          onAuthor={(v) => mutate((d) => void (d.author = v))}
          hasBody={a.episodes.some((e) => e.chapters.some((c) => c.body))}
          note="本文のある話だけを、話の順に1冊にまとめます(各話が目次の1項目になります)。"
          makeBook={(author, includeBible) => anthologyBook(a, author, includeBible)}
        />
      )}
    </div>
  );
}

function EpisodePanel(props: {
  anthology: Anthology;
  index: number;
  episode: Story;
  settings: Settings;
  run: RunState;
  gacha: GachaState;
  updateGacha: (fn: (s: GachaState) => GachaState) => void;
  mutate: Mutate;
  start: (t: Task) => void;
  stop: () => void;
  /** 生成中は話の追加・削除・やり直しを禁止する(生成中の話の位置がずれるため) */
  structureLocked: boolean;
  onDecide: (c: Concept, keywords: string[], note: string, lines: string[]) => void;
  onRebuildFrom: () => void;
  onUpdateHistory: () => void;
  onPromoteEntry: (kind: EntryKind, e: Entry) => void;
  onRedo: () => void;
  onRemove: () => void;
  onPromote: (c: CharacterSheet) => void;
  onCastIds: (ids: string[]) => void;
}) {
  const { anthology: a, index, episode: ep, run } = props;
  const cast = a.cast ?? [];
  const picker = cast.length > 0 && (
    <CastPicker
      cast={cast}
      selected={ep.castIds ?? []}
      onChange={props.onCastIds}
      locked={ep.bible.generated}
      series={isSeries(a)}
    />
  );
  const [tab, setTab] = useState<"overview" | "production" | "body" | "bible">(
    ep.chapters.some((c) => c.body) ? "body" : "production",
  );
  const n = index + 1;
  const target = ep.plan.scenes * ep.plan.charsPerScene;
  const otherTitles = a.episodes.filter((e) => e.id !== ep.id && e.title).map((e) => e.title);
  const runningThis = run.running && run.storyId === ep.id;
  const undecided = isUndecided(ep);

  // 概要が未決定のあいだは、ガチャ欄の入力(タイトル・キーワード・補足・セリフ)を「仕込み」として話に保存する。
  // おまかせ生成は、この仕込みを使ってあらすじを自動で作る。
  const prep = JSON.stringify([props.gacha.keywords, props.gacha.note, props.gacha.title.trim(), parseLines(props.gacha.lines)]);
  const saved = JSON.stringify([ep.keywords, ep.note ?? "", ep.plannedTitle ?? "", ep.lines ?? []]);
  useEffect(() => {
    if (!undecided || prep === saved) return;
    const [keywords, note, title, lines] = JSON.parse(prep) as [string[], string, string, string[]];
    props.mutate((s) => Object.assign(s, { keywords, note, plannedTitle: title, lines }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prep, saved, undecided]);

  if (undecided) {
    return (
      <div className="stack grow">
        <div className="row between">
          <h3>第{n}話 — 概要をガチャで決める</h3>
          <button className="small danger" disabled={props.structureLocked} onClick={props.onRemove}>
            この話を削除
          </button>
        </div>
        <p className="muted small-text">
          約{target.toLocaleString()}字の1話完結の短編として案を考えます。他の話とタイトル・内容が被らないようにします。
          ここに入力したタイトル・キーワード・補足・セリフ・出演者は保存され、ガチャを引かなくても「おまかせ」での生成時に使われます。
        </p>
        <ConceptGacha
          settings={props.settings}
          state={props.gacha}
          update={props.updateGacha}
          short={{ chars: target }}
          avoidTitles={otherTitles}
          shared={sharedContextFor(a, index)}
          extra={picker}
          confirmLabel={`この案で第${n}話を決定 →`}
          onConfirm={(p) => props.onDecide(p.concept, cleanKeywords(p.keywords), p.note, p.lines)}
        />
      </div>
    );
  }

  return (
    <div className="stack grow">
      <div className="row between">
        <h3>
          第{n}話「{ep.title}」
        </h3>
        <div className="row">
          {runningThis && <span className="running">● {run.stage}</span>}
          <button
            className="small"
            disabled={props.structureLocked}
            title="この話の概要を未決定に戻し、今の案を【元の案】としてガチャを引き直します"
            onClick={props.onRedo}
          >
            ガチャからやり直す
          </button>
          {isSeries(a) && (
            <button
              className="small"
              disabled={run.running || !ep.chapters.some((c) => c.body)}
              title="この話の本文を読み直して、共通の設定の「これまでの経緯」を更新します。本文を直した後に使います。"
              onClick={props.onUpdateHistory}
            >
              経緯を本文から更新
            </button>
          )}
          <button
            className="small"
            disabled={run.running}
            title="この話から最後までを、最新の共通設定と経緯で作り直します"
            onClick={props.onRebuildFrom}
          >
            この話以降を作り直す
          </button>
          <button className="small danger" disabled={props.structureLocked} onClick={props.onRemove}>
            この話を削除
          </button>
        </div>
      </div>
      <nav className="tabs">
        {(
          [
            ["overview", "概要"],
            ["production", "制作"],
            ["body", "本文"],
            ["bible", "設定資料"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === "overview" && (
        <div className="stack">
          {picker && <section className="card">{picker}</section>}
          <OverviewTab story={ep} mutate={props.mutate} />
        </div>
      )}
      {tab === "production" && (
        <ProductionTab
          story={ep}
          run={run}
          mutate={props.mutate}
          start={props.start}
          stop={props.stop}
          disabled={run.running && run.storyId !== ep.id}
        />
      )}
      {tab === "body" && <BodyTab story={ep} mutate={props.mutate} start={props.start} running={run.running} />}
      {tab === "bible" && (
        <BibleTab
          story={ep}
          mutate={props.mutate}
          start={props.start}
          running={run.running}
          onPromote={props.onPromote}
          isShared={(name) => castOf(a, ep).some((c) => sameName(c.name, name))}
          onPromoteEntry={props.onPromoteEntry}
          isSharedEntry={(kind, name) => sharedEntries(a).some((x) => x.kind === kind && sameName(x.entry.name, name))}
        />
      )}
    </div>
  );
}

/** 話に出演する共通の登場人物の選択 */
function CastPicker(props: {
  cast: SharedCharacter[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** 設定資料の作成後は、出演者を変えても設定資料に反映されない */
  locked: boolean;
  series: boolean;
}) {
  const toggle = (id: string) =>
    props.onChange(props.selected.includes(id) ? props.selected.filter((x) => x !== id) : [...props.selected, id]);
  return (
    <div className="field">
      <span>この話に登場する共通の登場人物(同一人物として扱います)</span>
      <div className="row wrap">
        {props.cast.map((c) => (
          <label key={c.id} className="check">
            <input type="checkbox" checked={props.selected.includes(c.id)} onChange={() => toggle(c.id)} />
            {c.name}
            {c.role && <span className="muted small-text">({c.role})</span>}
          </label>
        ))}
      </div>
      <small className="muted">
        {props.locked
          ? "設定資料は作成済みです。出演者を変えた場合は「制作」タブで設定資料を作り直してください。"
          : props.series
            ? "選んだ人物の設定と、前の話までの経緯がガチャ・設定資料・本文に引き継がれます。"
            : "選んだ人物の設定がガチャ・設定資料・本文に引き継がれます。"}
      </small>
    </div>
  );
}

function InfoTab({ anthology: a, mutate, settings }: { anthology: Anthology; mutate: MutateAnthology; settings: Settings }) {
  const unstarted = a.episodes.filter((e) => !e.chapters.length).length;
  const label = (id: string) => {
    const i = a.episodes.findIndex((e) => e.id === id);
    return i < 0 ? "(削除された話)" : `第${i + 1}話「${a.episodes[i].title}」`;
  };
  return (
    <div className="stack">
      <Section title="短編集の種類">
        <ModeSelect mode={a.mode ?? "omnibus"} onChange={(m) => mutate((d) => void (d.mode = m))} />
        <Field
          label="共通の世界観・舞台(全話に適用されます)"
          rows={3}
          value={a.world ?? ""}
          onChange={(v) => mutate((d) => void (d.world = v))}
        />
      </Section>
      <Section title="共通の登場人物">
        <CastEditor
          cast={a.cast ?? []}
          onChange={(fn) => mutate((d) => void (d.cast = fn(d.cast ?? [])))}
          settings={settings}
          context={{ title: a.title, keywords: a.keywords, note: a.note, world: a.world ?? "" }}
          onWorld={(w) => mutate((d) => void (d.world = w))}
          episodeLabel={label}
        />
      </Section>
      <Section title="共通の場所・品物・用語">
        <SharedEntriesEditor
          shared={a.shared ?? {}}
          onChange={(fn) => mutate((d) => void (d.shared = fn(d.shared ?? {})))}
          settings={settings}
          context={{ title: a.title, keywords: a.keywords, note: a.note, world: a.world ?? "", cast: (a.cast ?? []).map((c) => c.name) }}
          episodeLabel={label}
        />
      </Section>
      <Section title="短編集の情報">
        <Field label="タイトル" value={a.title} onChange={(v) => mutate((d) => void (d.title = v))} />
        <Field
          label="全話に共通するキーワード(読点区切り。概要が未決定の話のガチャの初期値になります)"
          value={a.keywords.join("、")}
          onChange={(v) => mutate((d) => void (d.keywords = v.split(/[,、，]+/).map((k) => k.trim()).filter(Boolean)))}
        />
        <Field label="全話に共通する補足の希望" rows={2} value={a.note} onChange={(v) => mutate((d) => void (d.note = v))} />
      </Section>
      <Section title="1話あたりの規模(既定値)">
        <div className="two-col">
          <label className="field">
            <span>場面数</span>
            <input
              type="number"
              min={2}
              max={8}
              value={a.plan.scenes}
              onChange={(e) => mutate((d) => void (d.plan.scenes = Math.min(8, Math.max(2, Number(e.target.value) || 2))))}
            />
          </label>
          <label className="field">
            <span>1場面の文字数(目安)</span>
            <input
              type="number"
              min={600}
              max={4000}
              step={100}
              value={a.plan.charsPerScene}
              onChange={(e) => mutate((d) => void (d.plan.charsPerScene = Math.min(4000, Math.max(600, Number(e.target.value) || 600))))}
            />
          </label>
        </div>
        <p className="muted small-text">新しく追加する話に使われます。既存の話の規模は、各話の「制作」タブで変更できます。</p>
        <div className="row">
          <button
            disabled={unstarted === 0}
            onClick={() =>
              mutate((d) => {
                for (const e of d.episodes) {
                  if (!e.chapters.length) e.plan = { chapters: 1, scenes: d.plan.scenes, charsPerScene: d.plan.charsPerScene };
                }
              })
            }
          >
            構成がまだない話({unstarted}話)にこの規模を反映
          </button>
        </div>
      </Section>
    </div>
  );
}
