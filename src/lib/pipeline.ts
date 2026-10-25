import type { Bible, BookPlan, Chapter, CharacterSheet, Concept, Entry, EntryKind, Issue, KakuyomuInfo, Settings, SharedContext, Story } from "../types";
import { emptyBible, KAKUYOMU_CATCHCOPY_MAX, KAKUYOMU_POST_MIN, KAKUYOMU_TAGS_MAX } from "../types";
import { chat, chatJson } from "./ollama";
import {
  biblePrompt,
  bibleUpdatePrompt,
  conceptPrompt,
  consistencyPrompt,
  digestPrompt,
  outlinePrompt,
  proofreadChunkPrompt,
  scenePrompt,
  acquiringEntries,
  castPrompt,
  castChangesPrompt,
  entriesPrompt,
  insertLinePrompt,
  kakuyomuPrompt,
  subtitlesPrompt,
  type ConceptRequest,
} from "./prompts";
import {
  bibleUpdateSchema,
  bibleSchema,
  conceptSchema,
  digestSchema,
  issuesSchema,
  outlineSchema,
  castSchema,
  castChangesSchema,
  entriesSchema,
  kakuyomuSchema,
  subtitlesSchema,
} from "./schemas";
import { normalizeNumbers } from "./numbers";
import { cleanProse, countChars, decodeByteTokens, hasLine, lineBracketOk, lineQuoted, joinScenes, lineCore, linePos, sameName, splitChunks, tail } from "./text";

/** パイプラインが物語を読み書きするための窓口(UI 側が保存を担当する)。 */
export interface Ctx {
  settings: Settings;
  signal: AbortSignal;
  get(): Story;
  update(mutator: (draft: Story) => void): void;
  stage(label: string): void;
  stream(text: string): void;
  log(msg: string): void;
}

export type Task =
  | { kind: "all" }
  | { kind: "bible" }
  | { kind: "outline" }
  | { kind: "subtitles" }
  | { kind: "numbers"; index: number | "all" }
  | { kind: "chapter"; index: number }
  | { kind: "proofread"; index: number | "all" };

function throwIfAborted(ctx: Ctx) {
  if (ctx.signal.aborted) throw new DOMException("中断しました", "AbortError");
}

// ---------------------------------------------------------------- 企画(ガチャ)

export async function pullConcept(settings: Settings, req: ConceptRequest, signal?: AbortSignal): Promise<Concept> {
  const c = await chatJson<Concept>(settings, {
    messages: conceptPrompt(req),
    schema: conceptSchema,
    temperature: Math.min(1.1, settings.temperature + 0.25),
    signal,
  });
  return {
    // タイトルを手入力した場合は、モデルが言い換えてもそのタイトルを使う
    title: req.title?.trim() || (c.title?.trim() ?? ""),
    tagline: c.tagline?.trim() ?? "",
    // ジャンルが決まっている場合(短編集の共通のジャンル)は、モデルが言い換えてもそれを使う
    genre: req.genre?.trim() || (c.genre?.trim() ?? ""),
    synopsis: c.synopsis?.trim() ?? "",
    characters: (c.characters ?? []).filter((x) => x.name?.trim()),
  };
}

// ---------------------------------------------------------------- 設定資料

async function stepBible(ctx: Ctx) {
  ctx.stage("設定資料を作成中");
  const raw = await chatJson<Bible>(ctx.settings, {
    messages: biblePrompt(ctx.get()),
    schema: bibleSchema,
    signal: ctx.signal,
    numPredict: 12000,
  });
  ctx.update((s) => {
    s.bible = {
      ...emptyBible(),
      ...raw,
      characters: mergeShared(
        (raw.characters ?? []).map((c) => ({ ...c, notes: "" })),
        s.shared?.characters ?? [],
      ),
      places: mergeSharedEntries("places", raw.places, s.shared),
      items: mergeSharedEntries("items", raw.items, s.shared),
      terms: mergeSharedEntries("terms", raw.terms, s.shared),
      generated: true,
    };
  });
  ctx.log("設定資料を作成しました");
}

/** 短編集の共通の登場人物を設定資料の先頭に入れる(同名の人物がいれば共通設定で置き換える)。 */
function mergeShared(chars: CharacterSheet[], shared: (CharacterSheet & { history: string })[]): CharacterSheet[] {
  const fixed = shared.map(({ history, ...c }) => ({ ...c, notes: history ? `これまでの経緯:${history}` : "" }));
  return [...fixed, ...chars.filter((c) => !fixed.some((f) => sameName(f.name, c.name)))];
}

/** 短編集の共通の場所・品物・用語を設定資料の先頭に入れる(同名のものがあれば共通設定で置き換える)。 */
function mergeSharedEntries(kind: EntryKind, list: Omit<Entry, "notes">[] | undefined, shared: SharedContext | undefined): Entry[] {
  const fixed = (shared?.entries ?? [])
    .filter((e) => e.kind === kind)
    .map((e) => ({
      name: e.name,
      description: e.description,
      notes: [
        e.status === "acquire" && "この話の途中で手に入れる(話の始まりでは、まだ誰も持っていない)",
        e.condition && `条件:${e.condition}`,
        e.history && `これまでの経緯:${e.history}`,
      ]
        .filter(Boolean)
        .join(" / "),
    }));
  const own = (list ?? []).filter((e) => !fixed.some((f) => sameName(f.name, e.name))).map((e) => ({ ...e, notes: "" }));
  return [...fixed, ...own];
}

// ---------------------------------------------------------------- 短編集の共通の登場人物

/** 短編集の共通の設定(場所・品物・用語)の案を考える */
export async function generateEntries(
  settings: Settings,
  opts: Parameters<typeof entriesPrompt>[0],
  signal?: AbortSignal,
): Promise<Entry[]> {
  const r = await chatJson<{ entries: { name: string; description: string }[] }>(settings, {
    messages: entriesPrompt(opts),
    schema: entriesSchema,
    temperature: Math.min(1.1, settings.temperature + 0.2),
    signal,
  });
  return (r.entries ?? []).filter((e) => e.name?.trim()).map((e) => ({ name: e.name.trim(), description: e.description ?? "", notes: "" }));
}


/** 短編集の共通の登場人物の案を考える */
export async function generateCast(
  settings: Settings,
  opts: { title: string; keywords: string[]; note: string; world: string; existing: string[]; count: number },
  signal?: AbortSignal,
): Promise<{ world: string; characters: CharacterSheet[] }> {
  const r = await chatJson<{ world: string; characters: CharacterSheet[] }>(settings, {
    messages: castPrompt(opts),
    schema: castSchema,
    temperature: Math.min(1.1, settings.temperature + 0.2),
    signal,
  });
  return {
    world: r.world?.trim() ?? "",
    characters: (r.characters ?? []).filter((c) => c.name?.trim()).map((c) => ({ ...c, notes: "" })),
  };
}

/** 1話の本文から、共通の登場人物に起きた変化を抜き出す */
export async function summarizeCastChanges(ctx: Ctx, names: string[]): Promise<{ name: string; change: string }[]> {
  const r = await chatJson<{ changes: { name: string; change: string }[] }>(ctx.settings, {
    messages: castChangesPrompt(ctx.get(), names),
    schema: castChangesSchema,
    signal: ctx.signal,
    numPredict: 2048,
    temperature: 0.2,
  });
  return (r.changes ?? []).filter((c) => c.name?.trim() && c.change?.trim());
}

// ---------------------------------------------------------------- 章構成

async function stepOutline(ctx: Ctx) {
  ctx.stage("章構成を作成中");
  const plan: BookPlan = ctx.get().plan;
  const raw = await chatJson<{
    chapters: { title: string; plan: string; beats: string[] }[];
    lineScenes?: { line: string; chapter: number; scene: number }[];
    acquireScenes?: { name: string; chapter: number; scene: number }[];
  }>(ctx.settings, {
    messages: outlinePrompt(ctx.get(), plan),
    schema: outlineSchema,
    signal: ctx.signal,
    numPredict: 12000,
  });
  const chapters = (raw.chapters ?? []).filter((c) => c.beats?.length);
  if (!chapters.length) throw new Error("章構成を生成できませんでした");
  ctx.update((s) => {
    s.chapters = chapters.map<Chapter>((c) => ({
      title: c.title.trim(),
      plan: c.plan.trim(),
      beats: c.beats.map((b) => b.trim()),
      body: "",
      sceneDone: 0,
      digest: "",
      proofread: false,
      issues: [],
      lines: [],
      acquire: [],
    }));
    // 使ってほしいセリフを、上から順に登場するように場面へ割り当てる
    orderLines(s, raw.lineScenes ?? []);

    // この話の途中で手に入れる共通の品物について、手に入れる場面を決める
    const last = s.chapters.length - 1;
    for (const item of acquiringEntries(s.shared)) {
      const a = (raw.acquireScenes ?? []).find((x) => sameName(x.name ?? "", item.name));
      let ci = (a?.chapter ?? 0) - 1;
      let si = (a?.scene ?? 0) - 1;
      // 「最後に手に入れる」と指定された場合や、モデルが場面を決めなかった場合は、最後の場面にする
      if (item.acquireAt === "last" || !s.chapters[ci] || si < 0 || si >= s.chapters[ci].beats.length) {
        ci = last;
        si = s.chapters[last].beats.length - 1;
      }
      s.chapters[ci].acquire!.push({ name: item.name, scene: si });
    }
  });
  for (const c of ctx.get().chapters) {
    for (const x of c.acquire ?? []) ctx.log(`「${x.name}」は場面${x.scene + 1}で手に入れます`);
  }
  ctx.log(`全${chapters.length}章の構成を作成しました`);
  // カクヨム連載では、場面(=連載1回分)ごとにサブタイトルを付ける
  if (ctx.get().shared?.serial) await stepSubtitles(ctx);
}

/** ci 章 si 場面より後の場面で使うと決めたセリフ */
function laterLines(s: Story, ci: number, si: number): string[] {
  return s.chapters.flatMap((c, i) => (c.lines ?? []).filter((l) => i > ci || (i === ci && l.scene > si)).map((l) => l.text));
}

/** 場面の本文が、指定のセリフの決まりをどれだけ破っているか */
function lineViolations(text: string, lines: string[], later: string[]) {
  const missing = lines.filter((l) => !hasLine(text, l));
  const pos = lines.map((l) => linePos(text, l)).filter((p) => p >= 0);
  const outOfOrder = pos.filter((p, i) => i > 0 && p < pos[i - 1]).length;
  const early = later.filter((l) => hasLine(text, l));
  // 指定した括弧(『』【】など)と違う括弧で書かれているもの
  const wrongBracket = lines.filter((l) => hasLine(text, l) && lineBracketOk(text, l) === false);
  return { missing, outOfOrder, early, wrongBracket, total: missing.length + outOfOrder + early.length + wrongBracket.length };
}

/** 全章を通した場面の並び(章の順・場面の順) */
function sceneSlots(s: Story): { ci: number; si: number }[] {
  return s.chapters.flatMap((c, ci) => c.beats.map((_, si) => ({ ci, si })));
}

/** セリフが割り当てられている場面の通し番号。割り当てがなければ -1 */
function assignedSlot(s: Story, line: string): number {
  const slots = sceneSlots(s);
  for (const [ci, c] of s.chapters.entries()) {
    const hit = c.lines?.find((x) => x.text === line);
    if (hit) return slots.findIndex((x) => x.ci === ci && x.si === hit.scene);
  }
  return -1;
}

/**
 * 使ってほしいセリフを、入力された順番(上から順)に登場するよう場面へ割り当てる。
 * モデルが決めた場面は順番が入れ替わらない範囲で使い、順番が逆のものは直前のセリフと同じ場面に寄せる。
 * モデルが決めなかったものは、前後のセリフの場面の間に等間隔に置く。
 */
export function orderLines(s: Story, proposed: { line: string; chapter: number; scene: number }[]) {
  const lines = s.lines ?? [];
  const slots = sceneSlots(s);
  if (!lines.length || !slots.length) return;
  const want: (number | undefined)[] = lines.map((l) => {
    const a = proposed.find((p) => lineCore(p.line ?? "") === lineCore(l) || p.line?.trim() === l);
    if (!a) return undefined;
    const g = slots.findIndex((x) => x.ci === (a.chapter ?? 0) - 1 && x.si === (a.scene ?? 0) - 1);
    return g >= 0 ? g : undefined;
  });
  // 提案のうち、順番どおりに並ぶ最も多い組(最長の非減少部分列)だけを採用し、残りは決め直す。
  // (1つだけ外れた提案のせいで、後のセリフがすべて最後の場面に押し込まれるのを防ぐ)
  const defined = want.map((g, i) => ({ g, i })).filter((x): x is { g: number; i: number } => x.g !== undefined);
  const len = defined.map(() => 1);
  const from = defined.map(() => -1);
  for (let b = 0; b < defined.length; b++) {
    for (let a = 0; a < b; a++) {
      if (defined[a].g <= defined[b].g && len[a] + 1 > len[b]) {
        len[b] = len[a] + 1;
        from[b] = a;
      }
    }
  }
  const keep = new Set<number>();
  for (let k = len.indexOf(Math.max(0, ...len)); k >= 0; k = from[k]) keep.add(defined[k].i);
  want.forEach((_, i) => {
    if (!keep.has(i)) want[i] = undefined;
  });
  for (let i = 0; i < want.length; i++) {
    if (want[i] !== undefined) continue;
    let j = i;
    while (j < want.length && want[j] === undefined) j++;
    const lo = i > 0 ? want[i - 1]! : 0;
    const hi = j < want.length ? want[j]! : slots.length - 1;
    for (let k = 0; k < j - i; k++) want[i + k] = Math.round(lo + ((k + 1) * (hi - lo)) / (j - i + 1));
    i = j - 1;
  }
  lines.forEach((text, i) => {
    const slot = slots[want[i]!];
    (s.chapters[slot.ci].lines ??= []).push({ text, scene: slot.si });
  });
}

/**
 * 使う場面が決まっていないセリフを、まだ書いていない場面に割り当てる(構成を作った後にセリフを追加した場合)。
 * 上から順に登場するよう、前後のセリフの場面の間に置く。
 */
export function assignLines(s: Story) {
  const lines = s.lines ?? [];
  const body = s.chapters.map((c) => c.body).join("\n");
  const slots = sceneSlots(s);
  // まだ書いていない最初の場面
  const firstOpen = slots.findIndex((x) => x.si >= s.chapters[x.ci].sceneDone);
  if (firstOpen < 0) return;
  lines.forEach((line, i) => {
    if (hasLine(body, line) || assignedSlot(s, line) >= 0) return;
    const before = lines.slice(0, i).map((l) => assignedSlot(s, l)).filter((g) => g >= 0);
    const after = lines.slice(i + 1).map((l) => assignedSlot(s, l)).filter((g) => g >= 0);
    const lo = Math.max(firstOpen, ...before);
    const hi = Math.max(lo, after.length ? Math.min(...after) : slots.length - 1);
    const slot = slots[Math.round((lo + hi) / 2)];
    (s.chapters[slot.ci].lines ??= []).push({ text: line, scene: slot.si });
    // 同じ場面の中でも、入力された順に並べる
    s.chapters[slot.ci].lines!.sort((x, y) => lines.indexOf(x.text) - lines.indexOf(y.text));
  });
}

/** カクヨム連載:場面(=連載1回分)ごとのサブタイトルを作る */
async function stepSubtitles(ctx: Ctx) {
  const ch = ctx.get().chapters[0];
  if (!ch) return;
  ctx.stage("各回のサブタイトルを作成中");
  const r = await chatJson<{ titles: string[] }>(ctx.settings, {
    messages: subtitlesPrompt(ctx.get()),
    schema: subtitlesSchema,
    signal: ctx.signal,
    numPredict: 1024,
  });
  const titles = (r.titles ?? []).map((x) => x.replace(/^[「『]|[」』]$/g, "").trim());
  ctx.update((s) => {
    const c = s.chapters[0];
    c.sceneTitles = c.beats.map((_, i) => titles[i] || c.sceneTitles?.[i] || `${i + 1}`);
  });
  ctx.log(`サブタイトルを作成しました:${ctx.get().chapters[0].sceneTitles!.join(" / ")}`);
}

/** カクヨム連載:キャッチコピー・紹介文・タグを考える(上限を超えたら作り直し、それでも超えたら切り詰める) */
export async function generateKakuyomuInfo(
  settings: Settings,
  opts: Omit<Parameters<typeof kakuyomuPrompt>[0], "catchcopyMax" | "tagsMax">,
  signal?: AbortSignal,
): Promise<KakuyomuInfo> {
  let last: KakuyomuInfo | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await chatJson<KakuyomuInfo>(settings, {
      messages: kakuyomuPrompt({ ...opts, catchcopyMax: KAKUYOMU_CATCHCOPY_MAX, tagsMax: KAKUYOMU_TAGS_MAX }),
      schema: kakuyomuSchema,
      temperature: Math.min(1.1, settings.temperature + 0.1),
      signal,
    });
    const tags = [...new Set((r.tags ?? []).map((t) => t.replace(/[#＃\s　]/g, "")).filter(Boolean))];
    last = { catchcopy: (r.catchcopy ?? "").trim(), introduction: (r.introduction ?? "").trim(), tags };
    if ([...last.catchcopy].length <= KAKUYOMU_CATCHCOPY_MAX && last.tags.length <= KAKUYOMU_TAGS_MAX) return last;
  }
  return {
    catchcopy: [...last!.catchcopy].slice(0, KAKUYOMU_CATCHCOPY_MAX).join(""),
    introduction: last!.introduction,
    tags: last!.tags.slice(0, KAKUYOMU_TAGS_MAX),
  };
}

// ---------------------------------------------------------------- 本文

/** 直前の本文(章をまたいでもよい)の末尾を返す。 */
function previousTail(story: Story, ci: number): string {
  for (let i = ci; i >= 0; i--) {
    const body = story.chapters[i].body;
    if (body) return tail(body, 900);
  }
  return "";
}

async function writeScene(ctx: Ctx, ci: number, si: number) {
  const { settings } = ctx;
  const target = ctx.get().plan.charsPerScene;
  // この場面で使うと決めたセリフ(上から順)と、後の場面で使うのでこの場面ではまだ使わないセリフ
  const lines = (ctx.get().chapters[ci].lines ?? []).filter((l) => l.scene === si).map((l) => l.text);
  const later = laterLines(ctx.get(), ci, si);
  let scene = "";
  // 目標の約7割に満たない場合は書き足す。カクヨム連載では、1回分が最低文字数に届くまで書き足す
  const serial = !!ctx.get().shared?.serial;
  const enough = serial ? Math.min(KAKUYOMU_POST_MIN, target) : target * 0.7;
  for (let pass = 0; pass < (serial ? 4 : 3); pass++) {
    throwIfAborted(ctx);
    const story = ctx.get();
    const raw = await chat(settings, {
      messages: scenePrompt({
        story,
        ci,
        si,
        target: pass === 0 ? target : Math.max(600, target - countChars(scene)),
        previousTail: scene ? tail(scene, 900) : previousTail(story, ci),
        existingInScene: scene || undefined,
        lines: lines.filter((l) => !hasLine(scene, l)),
        later,
      }),
      signal: ctx.signal,
      numPredict: Math.round(target * 3),
      temperature: settings.temperature,
      onToken: (t) => ctx.stream(scene ? `${scene}\n${t}` : t),
    });
    const text = cleanProse(raw);
    if (!text) continue;
    scene = scene ? `${scene}\n${text}` : text;
    if (countChars(scene) >= enough) break;
  }
  if (!scene) throw new Error("本文を生成できませんでした");

  // 指定のセリフが「すべて入っている」「上から順」「後の場面のセリフを先取りしていない」かを確かめ、
  // 守られていなければ書き直してもらう(最大2回。違反が減った場合だけ採用する)
  for (let attempt = 0; attempt < 2; attempt++) {
    const v = lineViolations(scene, lines, later);
    if (!v.total) break;
    throwIfAborted(ctx);
    ctx.stage(`第${ci + 1}章 場面${si + 1} の指定のセリフを直しています`);
    const raw = await chat(settings, {
      messages: insertLinePrompt(ctx.get(), scene, [...v.missing, ...v.wrongBracket], lines, v.early),
      signal: ctx.signal,
      numPredict: Math.round(scene.length * 2.5) + 512,
      temperature: 0.5,
      onToken: (t) => ctx.stream(t),
    });
    const cand = cleanProse(raw);
    const better = lineViolations(cand, lines, later).total < v.total;
    if (cand && better && cand.length > scene.length * 0.8 && cand.length < scene.length * 1.6) scene = cand;
  }
  const left = lineViolations(scene, lines, later);
  if (left.missing.length) ctx.log(`第${ci + 1}章 場面${si + 1}:指定のセリフを入れられませんでした(${left.missing.join(" / ")})`);
  if (left.outOfOrder) ctx.log(`第${ci + 1}章 場面${si + 1}:指定のセリフの順番を直せませんでした`);
  if (left.wrongBracket.length) ctx.log(`第${ci + 1}章 場面${si + 1}:指定と違う括弧で書かれたセリフがあります(${left.wrongBracket.join(" / ")})`);
  if (left.early.length) ctx.log(`第${ci + 1}章 場面${si + 1}:後の場面のセリフを先に使っています(${left.early.join(" / ")})`);

  ctx.update((s) => {
    const ch = s.chapters[ci];
    ch.body = joinScenes(ch.body, scene);
    ch.sceneDone = si + 1;
    ch.proofread = false;
    ch.issues = [];
  });
}

async function stepDigest(ctx: Ctx, ci: number) {
  const r = await chatJson<{ digest: string }>(ctx.settings, {
    messages: digestPrompt(ctx.get(), ci),
    schema: digestSchema,
    signal: ctx.signal,
    numPredict: 1024,
    temperature: 0.3,
  });
  ctx.update((s) => {
    s.chapters[ci].digest = (r.digest ?? "").trim() || s.chapters[ci].plan;
  });
}

type BibleUpdate = {
  characters: (Record<string, string> & { name: string })[];
  places: { name: string; description: string; notes: string }[];
  items: { name: string; description: string; notes: string }[];
  terms: { name: string; description: string; notes: string }[];
};

function appendNote(prev: string, add: string): string {
  const a = add?.trim();
  if (!a) return prev;
  if (prev.includes(a)) return prev;
  return prev ? `${prev} / ${a}` : a;
}

/** 本文で判明した新事実を設定資料へ反映する。 */
async function stepBibleSync(ctx: Ctx, ci: number) {
  const r = await chatJson<BibleUpdate>(ctx.settings, {
    messages: bibleUpdatePrompt(ctx.get(), ci),
    schema: bibleUpdateSchema,
    signal: ctx.signal,
    numPredict: 4096,
    temperature: 0.2,
  });
  let added = 0;
  ctx.update((s) => {
    const b = s.bible;
    for (const c of r.characters ?? []) {
      if (!c.name?.trim()) continue;
      const hit = b.characters.find((x) => sameName(x.name, c.name));
      if (hit) hit.notes = appendNote(hit.notes, c.notes);
      else {
        b.characters.push({
          name: c.name, reading: c.reading ?? "", role: c.role ?? "", age: c.age ?? "",
          appearance: c.appearance ?? "", personality: c.personality ?? "", speech: c.speech ?? "",
          background: c.background ?? "", relations: c.relations ?? "", notes: c.notes ?? "",
        });
        added++;
      }
    }
    for (const key of ["places", "items", "terms"] as const) {
      for (const e of r[key] ?? []) {
        if (!e.name?.trim()) continue;
        const hit = b[key].find((x) => sameName(x.name, e.name));
        if (hit) hit.notes = appendNote(hit.notes, e.notes);
        else {
          b[key].push({ name: e.name, description: e.description ?? "", notes: e.notes ?? "" });
          added++;
        }
      }
    }
  });
  if (added) ctx.log(`設定資料に ${added} 件の項目を追加しました`);
}

async function stepChapter(ctx: Ctx, ci: number) {
  // 構成を作った後に追加されたセリフにも、使う場面を割り当てる
  ctx.update((s) => assignLines(s));
  for (;;) {
    throwIfAborted(ctx);
    const ch = ctx.get().chapters[ci];
    if (ch.sceneDone >= ch.beats.length) break;
    const si = ch.sceneDone;
    ctx.stage(`第${ci + 1}章「${ch.title}」 場面 ${si + 1}/${ch.beats.length} を執筆中`);
    await writeScene(ctx, ci, si);
    ctx.log(`第${ci + 1}章 場面${si + 1} を執筆しました`);
  }
  if (!ctx.get().chapters[ci].digest) {
    ctx.stage(`第${ci + 1}章の要約を作成中`);
    await stepDigest(ctx, ci);
    ctx.stage(`第${ci + 1}章の内容を設定資料へ反映中`);
    await stepBibleSync(ctx, ci);
  }
}

// ---------------------------------------------------------------- 校閲

async function proofreadBody(ctx: Ctx, ci: number): Promise<number> {
  const body = ctx.get().chapters[ci].body;
  const chunks = splitChunks(body);
  const out: string[] = [];
  let changed = 0;
  const required = ctx.get().lines ?? [];
  for (let i = 0; i < chunks.length; i++) {
    throwIfAborted(ctx);
    ctx.stage(`第${ci + 1}章を校閲中 (${i + 1}/${chunks.length})`);
    const original = chunks[i];
    let fixed = original;
    // このかたまりに入っている指定のセリフは、校閲で書き換えさせない
    const protectedLines = required.filter((l) => hasLine(original, l));
    try {
      const raw = await chat(ctx.settings, {
        messages: proofreadChunkPrompt(ctx.get().bible, original, protectedLines.map(lineQuoted)),
        signal: ctx.signal,
        temperature: 0.2,
        numPredict: Math.round(original.length * 2.5) + 256,
        onToken: (t) => ctx.stream(t),
      });
      const cand = cleanProse(raw);
      // 暴走・要約・加筆を避けるため、長さと段落数が大きく変わった結果は採用しない
      const ratio = cand.length / original.length;
      const paraRatio = cand.split("\n").length / original.split("\n").length;
      const linesKept = protectedLines.every((l) => hasLine(cand, l) && lineBracketOk(cand, l) !== false);
      if (cand && linesKept && ratio > 0.85 && ratio < 1.15 && paraRatio > 0.8 && paraRatio < 1.25) fixed = cand;
    } catch (e) {
      if (ctx.signal.aborted) throw e;
    }
    if (fixed !== original) changed++;
    out.push(fixed);
  }
  // 場面区切りの空行を保つため、元の空行構造を再現する
  const joined = restoreBlankLines(body, out);
  ctx.update((s) => {
    s.chapters[ci].body = joined;
  });
  return changed;
}

/** チャンク分割で失われた空行(場面区切り)を元の本文から復元する。 */
function restoreBlankLines(original: string, chunks: string[]): string {
  const origLines = original.split("\n");
  const newLines = chunks.join("\n").split("\n");
  const result: string[] = [];
  let ni = 0;
  for (const line of origLines) {
    if (line === "") result.push("");
    else if (ni < newLines.length) result.push(newLines[ni++]);
  }
  while (ni < newLines.length) result.push(newLines[ni++]);
  return result.join("\n");
}

async function checkConsistency(ctx: Ctx, ci: number) {
  ctx.stage(`第${ci + 1}章の設定整合性を点検中`);
  const r = await chatJson<{ issues: { quote: string; problem: string; replacement: string }[] }>(ctx.settings, {
    messages: consistencyPrompt(ctx.get(), ci),
    schema: issuesSchema,
    signal: ctx.signal,
    numPredict: 3000,
    temperature: 0.1,
  });
  let applied = 0;
  ctx.update((s) => {
    const ch = s.chapters[ci];
    const issues: Issue[] = [];
    for (const it of r.issues ?? []) {
      const quote = it.quote?.trim();
      if (!quote || !it.problem?.trim()) continue;
      const replacement = it.replacement?.trim() ?? "";
      const occurrences = ch.body.split(quote).length - 1;
      const fixedBody = ch.body.replace(quote, () => replacement);
      // 指定のセリフを書き換えてしまう修正は自動では適用しない
      const keepsLines = (s.lines ?? []).every((l) => !hasLine(ch.body, l) || hasLine(fixedBody, l));
      const canApply = occurrences === 1 && replacement !== "" && replacement !== quote && keepsLines;
      if (canApply) {
        ch.body = fixedBody;
        applied++;
      }
      issues.push({ quote, problem: it.problem.trim(), replacement, applied: canApply });
    }
    // この章で使うと決めたセリフが本文に入っていなければ、指摘として残す
    for (const l of ch.lines ?? []) {
      if (!hasLine(ch.body, l.text)) {
        issues.push({
          quote: "",
          problem: `指定したセリフ「${lineCore(l.text)}」が本文に入っていません(場面${l.scene + 1}で使う予定でした)。本文に書き足すか、この章を再生成してください。`,
          replacement: "",
          applied: false,
        });
      }
    }
    // 指定した括弧(『』【】など)と違う括弧で書かれていないか
    for (const l of ch.lines ?? []) {
      if (hasLine(ch.body, l.text) && lineBracketOk(ch.body, l.text) === false) {
        issues.push({
          quote: lineCore(l.text),
          problem: `指定したセリフ「${lineCore(l.text)}」が、指定とは違う括弧で書かれています(指定:${lineQuoted(l.text)})。`,
          replacement: "",
          applied: false,
        });
      }
    }
    // 指定したセリフが上から順に登場しているか
    const order = s.lines ?? [];
    const used = (ch.lines ?? [])
      .map((l) => ({ text: l.text, at: linePos(ch.body, l.text), rank: order.indexOf(l.text) }))
      .filter((x) => x.at >= 0)
      .sort((x, y) => x.at - y.at);
    for (let k = 1; k < used.length; k++) {
      if (used[k].rank < used[k - 1].rank) {
        issues.push({
          quote: "",
          problem: `指定したセリフの順番が入れ替わっています。「${lineCore(used[k].text)}」が「${lineCore(used[k - 1].text)}」より後に出てきます。本文を直すか、この章を再生成してください。`,
          replacement: "",
          applied: false,
        });
      }
    }
    ch.issues = issues;
  });
  if (applied) ctx.log(`第${ci + 1}章:矛盾・表記の問題 ${applied} 件を自動修正しました`);
}

async function stepProofread(ctx: Ctx, ci: number) {
  const ch = ctx.get().chapters[ci];
  if (!ch.body) return;
  const changed = await proofreadBody(ctx, ci);
  unifyNumbers(ctx, ci);
  await checkConsistency(ctx, ci);
  ctx.update((s) => {
    s.chapters[ci].proofread = true;
  });
  ctx.log(`第${ci + 1}章を校閲しました(修正:${changed}箇所)`);
}

/**
 * 数字の表記(漢数字/算用数字)を設定に合わせて統一する。規則による変換なので LLM は使わない。
 * 使ってほしいセリフの中の数字は変えない。
 */
function unifyNumbers(ctx: Ctx, ci: number): number {
  const style = ctx.settings.numberStyle ?? "kanji";
  // あわせて、モデルがバイトのまま出力した文字(<0xE3><0x80><0x80> など)を本来の文字に戻す
  const bytes = decodeByteTokens(ctx.get().chapters[ci].body);
  const protect = (ctx.get().lines ?? []).map(lineCore);
  const r = normalizeNumbers(bytes.text, style, protect);
  if (!r.count && !bytes.count) return 0;
  ctx.update((s) => {
    s.chapters[ci].body = r.text;
  });
  if (bytes.count) ctx.log(`第${ci + 1}章:文字化けしていた文字を${bytes.count}箇所直しました`);
  if (r.count) ctx.log(`第${ci + 1}章:数字の表記を${style === "kanji" ? "漢数字" : "算用数字"}に統一しました(${r.count}箇所)`);
  return r.count + bytes.count;
}

// ---------------------------------------------------------------- 実行

function resetChapter(ch: Chapter) {
  ch.body = "";
  ch.sceneDone = 0;
  ch.digest = "";
  ch.proofread = false;
  ch.issues = [];
}

export async function runTask(ctx: Ctx, task: Task): Promise<void> {
  switch (task.kind) {
    case "bible":
      await stepBible(ctx);
      return;
    case "numbers": {
      const indices = task.index === "all" ? ctx.get().chapters.map((_, i) => i) : [task.index];
      let total = 0;
      for (const i of indices) total += unifyNumbers(ctx, i);
      if (!total) ctx.log("数字の表記は統一されていました");
      return;
    }
    case "subtitles":
      await stepSubtitles(ctx);
      return;
    case "outline":
      await stepOutline(ctx);
      return;
    case "chapter":
      ctx.update((s) => resetChapter(s.chapters[task.index]));
      await stepChapter(ctx, task.index);
      return;
    case "proofread": {
      const indices =
        task.index === "all"
          ? ctx.get().chapters.map((_, i) => i).filter((i) => ctx.get().chapters[i].body)
          : [task.index];
      for (const i of indices) await stepProofread(ctx, i);
      return;
    }
    case "all": {
      ctx.update((s) => {
        s.status = "producing";
      });
      if (!ctx.get().bible.generated) await stepBible(ctx);
      if (!ctx.get().chapters.length) await stepOutline(ctx);
      for (let i = 0; i < ctx.get().chapters.length; i++) await stepChapter(ctx, i);
      for (let i = 0; i < ctx.get().chapters.length; i++) {
        if (!ctx.get().chapters[i].proofread) await stepProofread(ctx, i);
      }
      ctx.update((s) => {
        s.status = "done";
      });
      ctx.stage("完了");
      ctx.log("物語が完成しました");
      return;
    }
  }
}
