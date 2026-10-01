import type { Bible, CharacterSheet, Entry, Story } from "../types";

/** 日本語の文字数(空白・改行を除く) */
export function countChars(text: string): number {
  return text.replace(/\s/g, "").length;
}

export function storyChars(story: Story): number {
  return story.chapters.reduce((n, c) => n + countChars(c.body), 0);
}

/** LLM 出力から前置き・コードフェンス・見出しなどを取り除き、段落を改行1つで区切った形に整える。 */
export function cleanProse(raw: string): string {
  let t = raw.replace(/\r\n?/g, "\n").trim();
  t = t.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "");
  t = t
    .split("\n")
    .filter((line) => !/^\s*(#{1,6}\s|\*\*.*\*\*\s*$|---+\s*$|={3,}\s*$)/.test(line))
    .join("\n");
  t = t.replace(/^(以下|では|それでは)[^\n]{0,40}(です|ます|ください)[。：:]?\n+/, "");
  return t
    .split("\n")
    .map((l) => l.replace(/^[ 　\t]+/, "").trimEnd())
    .filter((l) => l.length > 0)
    .join("\n");
}

/** 場面を連結する。場面間は空行で区切る。 */
export function joinScenes(existing: string, scene: string): string {
  return existing ? `${existing}\n\n${scene}` : scene;
}

export function tail(text: string, n: number): string {
  return text.length <= n ? text : "…" + text.slice(text.length - n);
}

/** 本文を約 max 文字ずつの段落単位のかたまりに分割する。 */
export function splitChunks(body: string, max = 1400): string[] {
  const chunks: string[] = [];
  let cur = "";
  for (const line of body.split("\n")) {
    if (cur && cur.length + line.length + 1 > max) {
      chunks.push(cur);
      cur = line;
    } else {
      cur = cur ? `${cur}\n${line}` : line;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

const line = (label: string, v: string) => (v?.trim() ? `${label}:${v.trim()}` : "");

function characterText(c: CharacterSheet): string {
  return [
    `■${c.name}${c.reading ? `(${c.reading})` : ""}`,
    line("役割", c.role),
    line("年齢", c.age),
    line("外見", c.appearance),
    line("性格", c.personality),
    line("口調", c.speech),
    line("経歴", c.background),
    line("関係", c.relations),
    line("追記", c.notes),
  ]
    .filter(Boolean)
    .join("\n");
}

function entryText(e: Entry): string {
  return `■${e.name}:${e.description}${e.notes?.trim() ? `(追記:${e.notes.trim()})` : ""}`;
}

/** 設定資料をプロンプト用のテキストにする。 */
export function bibleToText(b: Bible): string {
  const parts = [
    line("前提", b.premise),
    line("世界観", b.worldview),
    line("文体指針", b.style),
    line("年表", b.timeline),
    b.characters.length ? `【登場人物】\n${b.characters.map(characterText).join("\n")}` : "",
    b.places.length ? `【地名・場所】\n${b.places.map(entryText).join("\n")}` : "",
    b.items.length ? `【重要な品物】\n${b.items.map(entryText).join("\n")}` : "",
    b.terms.length ? `【用語・組織など】\n${b.terms.map(entryText).join("\n")}` : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

/** 名前が一致する要素を探す(空白・敬称ゆれを無視)。 */
export function sameName(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/[\s　・･]/g, "");
  return norm(a) === norm(b);
}

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}
