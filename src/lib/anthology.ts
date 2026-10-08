import type { Anthology, CharacterSheet, SharedCharacter, SharedContext, Story } from "../types";
import { newId, sameName } from "./text";

export const isSeries = (a: Anthology) => a.mode === "series";

/** 話に出演する共通の登場人物 */
export function castOf(a: Anthology, e: Story): SharedCharacter[] {
  const ids = e.castIds ?? [];
  return (a.cast ?? []).filter((c) => ids.includes(c.id));
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
 * 連作短編では、共通の登場人物の経緯とこれまでの話の流れを、その話より前の分だけ含める。
 */
export function sharedContextFor(a: Anthology, index: number): SharedContext {
  const series = isSeries(a);
  const earlier = new Set(a.episodes.slice(0, index).map((e) => e.id));
  const order = (id: string) => a.episodes.findIndex((e) => e.id === id);
  const characters = castOf(a, a.episodes[index]).map(({ id: _id, history, ...c }) => ({
    ...c,
    history: series
      ? history
          .filter((h) => earlier.has(h.episodeId))
          .sort((x, y) => order(x.episodeId) - order(y.episodeId))
          .map((h) => `第${order(h.episodeId) + 1}話:${h.text}`)
          .join(" / ")
      : "",
  }));
  const previous = series
    ? a.episodes
        .slice(0, index)
        .map((e, i) => ({ e, n: i + 1 }))
        .filter(({ e }) => e.title.trim())
        .map(({ e, n }) => `第${n}話「${e.title}」:${(e.chapters[0]?.digest || e.synopsis).slice(0, 160)}`)
        .join("\n")
    : "";
  return { characters, world: a.world ?? "", avoidNames: usedNames(a, index), previous };
}

/** 設定資料の人物を共通の登場人物にする */
export function toShared(c: CharacterSheet): SharedCharacter {
  return { ...c, id: newId(), notes: "", history: [] };
}

/** 1話で起きた変化を共通の登場人物の経緯に記録する(同じ話の記録は置き換える) */
export function recordHistory(a: Anthology, episodeId: string, changes: { name: string; change: string }[]) {
  for (const c of a.cast ?? []) {
    const hit = changes.find((x) => sameName(x.name, c.name));
    c.history = c.history.filter((h) => h.episodeId !== episodeId);
    if (hit) c.history.push({ episodeId, text: hit.change.trim() });
  }
}
