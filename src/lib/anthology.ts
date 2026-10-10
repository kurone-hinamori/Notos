import type { Anthology, CharacterSheet, Concept, Entry, EntryKind, SharedCharacter, SharedContext, SharedEntry, Story } from "../types";
import { emptyBible } from "../types";
import type { ConceptRequest } from "./prompts";
import { newId, sameName } from "./text";

export const ENTRY_KINDS: EntryKind[] = ["places", "items", "terms"];
export const ENTRY_LABEL: Record<EntryKind, string> = { places: "場所", items: "品物", terms: "用語" };

export const isSeries = (a: Anthology) => a.mode === "series";

/** 話に出演する共通の登場人物 */
export function castOf(a: Anthology, e: Story): SharedCharacter[] {
  const ids = e.castIds ?? [];
  return (a.cast ?? []).filter((c) => ids.includes(c.id));
}

/** 共通の場所・品物・用語(種類つき) */
export function sharedEntries(a: Anthology): { kind: EntryKind; entry: SharedEntry }[] {
  return ENTRY_KINDS.flatMap((kind) => (a.shared?.[kind] ?? []).map((entry) => ({ kind, entry })));
}

/** 他の話で使われている名前(共通の登場人物を除く)。同名の別人を避けるために使う。 */
function usedNames(a: Anthology, index: number): string[] {
  const cast = a.cast ?? [];
  const names = new Set<string>();
  a.episodes.forEach((e, i) => {
    if (i === index) return;
    for (const c of [...e.characters, ...e.bible.characters]) {
      if (c.name?.trim() && !cast.some((x) => sameName(x.name, c.name))) names.add(c.name.trim());
    }
  });
  return [...names];
}

/**
 * index 番目の話を考える・書くときに渡す共有情報を作る。
 * 連作短編では、共通の設定の経緯とこれまでの話の流れを、その話より前の分だけ含める。
 */
export function sharedContextFor(a: Anthology, index: number): SharedContext {
  const series = isSeries(a);
  const earlier = new Set(a.episodes.slice(0, index).map((e) => e.id));
  const order = (id: string) => a.episodes.findIndex((e) => e.id === id);
  const historyText = (history: { episodeId: string; text: string }[]) =>
    series
      ? history
          .filter((h) => earlier.has(h.episodeId))
          .sort((x, y) => order(x.episodeId) - order(y.episodeId))
          // 話数を書くと、あらすじや本文に「第1話で」と出てしまうので、古い順の番号だけを付ける
          .map((h, k) => `(${k + 1})${h.text}`)
          .join(" ")
      : "";
  const characters = castOf(a, a.episodes[index]).map(({ id: _id, history, ...c }) => ({ ...c, history: historyText(history) }));
  const entries = sharedEntries(a).map(({ kind, entry }) => ({
    kind,
    name: entry.name,
    description: entry.description,
    history: historyText(entry.history),
  }));
  const previous = series
    ? a.episodes
        .slice(0, index)
        .map((e, i) => ({ e, n: i + 1 }))
        .filter(({ e }) => e.title.trim())
        .map(({ e }) => `・「${e.title}」:${(e.chapters[0]?.digest || e.synopsis).slice(0, 160)}`)
        .join("\n")
    : "";
  return { characters, entries, world: a.world ?? "", avoidNames: usedNames(a, index), previous };
}

/** index 番目の話のあらすじをガチャ・おまかせで考えるときの条件 */
export function conceptRequestFor(
  a: Anthology,
  index: number,
  prep: { keywords: string[]; note: string; title: string; lines: string[] },
): ConceptRequest {
  const e = a.episodes[index];
  return {
    keywords: prep.keywords,
    note: prep.note,
    title: prep.title,
    lines: prep.lines,
    avoidTitles: a.episodes.filter((x) => x.id !== e.id && x.title.trim()).map((x) => x.title),
    short: { chars: e.plan.scenes * e.plan.charsPerScene },
    shared: sharedContextFor(a, index),
  };
}

/** あらすじを話に確定させる */
export function applyConcept(e: Story, c: Concept, keywords: string[], note: string, lines: string[]) {
  Object.assign(e, { ...c, keywords, note, lines, status: "concept" });
}

/** 話の設定資料・構成・本文を破棄する。concept が true ならあらすじも未決定に戻す(仕込みは残す)。 */
export function resetEpisode(e: Story, concept: boolean) {
  e.bible = emptyBible();
  e.chapters = [];
  e.status = "concept";
  delete e.shared;
  if (concept) {
    // 決めていたタイトルは、おまかせ生成でそのまま使えるよう仕込みに残す
    Object.assign(e, { title: "", tagline: "", genre: "", synopsis: "", characters: [] });
  }
}

/** 設定資料の人物を共通の登場人物にする */
export function toShared(c: CharacterSheet): SharedCharacter {
  return { ...c, id: newId(), notes: "", history: [] };
}

/** 設定資料の項目を共通の設定にする */
export function toSharedEntry(e: Pick<Entry, "name" | "description">): SharedEntry {
  return { name: e.name, description: e.description, notes: "", id: newId(), history: [] };
}

/** 話の経緯を記録する対象(出演する共通の登場人物と、共通の場所・品物・用語)の名前 */
export function historyTargets(a: Anthology, e: Story): string[] {
  return [...castOf(a, e).map((c) => c.name), ...sharedEntries(a).map((x) => x.entry.name)];
}

/** 1話で起きた変化を共通の設定の経緯に記録する(同じ話の記録は置き換える) */
export function recordHistory(a: Anthology, episodeId: string, changes: { name: string; change: string }[]) {
  const targets: { name: string; history: { episodeId: string; text: string }[] }[] = [
    ...(a.cast ?? []),
    ...sharedEntries(a).map((x) => x.entry),
  ];
  for (const t of targets) {
    const hit = changes.find((x) => sameName(x.name, t.name));
    const kept = t.history.filter((h) => h.episodeId !== episodeId);
    t.history.length = 0;
    t.history.push(...kept);
    // 長すぎる経緯は後の話のプロンプトを圧迫するので、上限を設ける
    if (hit) t.history.push({ episodeId, text: hit.change.trim().slice(0, 200) });
  }
}

/** 話の経緯の記録を消す(話を作り直すとき) */
export function clearHistory(a: Anthology, episodeIds: string[]) {
  for (const t of [...(a.cast ?? []), ...sharedEntries(a).map((x) => x.entry)]) {
    const kept = t.history.filter((h) => !episodeIds.includes(h.episodeId));
    t.history.length = 0;
    t.history.push(...kept);
  }
}

/** 未対応の「要確認」が残っているか */
export function hasOpenIssues(e: Story): boolean {
  return e.chapters.some((c) => c.issues.some((it) => !it.applied && !it.state));
}
