import type { Bible, BookPlan, Chapter, CharacterSheet, Concept, Issue, Settings, Story } from "../types";
import { emptyBible } from "../types";
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
  castPrompt,
  castChangesPrompt,
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
} from "./schemas";
import { cleanProse, countChars, joinScenes, sameName, splitChunks, tail } from "./text";

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
    genre: c.genre?.trim() ?? "",
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
      places: (raw.places ?? []).map((e) => ({ ...e, notes: "" })),
      items: (raw.items ?? []).map((e) => ({ ...e, notes: "" })),
      terms: (raw.terms ?? []).map((e) => ({ ...e, notes: "" })),
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

// ---------------------------------------------------------------- 短編集の共通の登場人物

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
  const raw = await chatJson<{ chapters: { title: string; plan: string; beats: string[] }[] }>(ctx.settings, {
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
    }));
  });
  ctx.log(`全${chapters.length}章の構成を作成しました`);
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
  let scene = "";
  // 目標の約7割に満たない場合は最大2回まで書き足す
  for (let pass = 0; pass < 3; pass++) {
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
      }),
      signal: ctx.signal,
      numPredict: Math.round(target * 3),
      temperature: settings.temperature,
      onToken: (t) => ctx.stream(scene ? `${scene}\n${t}` : t),
    });
    const text = cleanProse(raw);
    if (!text) continue;
    scene = scene ? `${scene}\n${text}` : text;
    if (countChars(scene) >= target * 0.7) break;
  }
  if (!scene) throw new Error("本文を生成できませんでした");
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
  for (let i = 0; i < chunks.length; i++) {
    throwIfAborted(ctx);
    ctx.stage(`第${ci + 1}章を校閲中 (${i + 1}/${chunks.length})`);
    const original = chunks[i];
    let fixed = original;
    try {
      const raw = await chat(ctx.settings, {
        messages: proofreadChunkPrompt(ctx.get().bible, original),
        signal: ctx.signal,
        temperature: 0.2,
        numPredict: Math.round(original.length * 2.5) + 256,
        onToken: (t) => ctx.stream(t),
      });
      const cand = cleanProse(raw);
      // 暴走・要約・加筆を避けるため、長さと段落数が大きく変わった結果は採用しない
      const ratio = cand.length / original.length;
      const paraRatio = cand.split("\n").length / original.split("\n").length;
      if (cand && ratio > 0.85 && ratio < 1.15 && paraRatio > 0.8 && paraRatio < 1.25) fixed = cand;
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
      const canApply = occurrences === 1 && replacement !== "" && replacement !== quote;
      if (canApply) {
        ch.body = ch.body.replace(quote, () => replacement);
        applied++;
      }
      issues.push({ quote, problem: it.problem.trim(), replacement, applied: canApply });
    }
    ch.issues = issues;
  });
  if (applied) ctx.log(`第${ci + 1}章:矛盾・表記の問題 ${applied} 件を自動修正しました`);
}

async function stepProofread(ctx: Ctx, ci: number) {
  const ch = ctx.get().chapters[ci];
  if (!ch.body) return;
  const changed = await proofreadBody(ctx, ci);
  await checkConsistency(ctx, ci);
  ctx.update((s) => {
    s.chapters[ci].proofread = true;
  });
  ctx.log(`第${ci + 1}章を校閲しました(修正:${changed}箇所)`);
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
