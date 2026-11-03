import type { RubyRule } from "../types";

/** カクヨム記法(ルビ・傍点)。本文にはそのまま保存し、カクヨム用の文章や EPUB にするときに使う */
const KANJI = "\\p{Script=Han}々〆〇ヶ";
const NOTATION = new RegExp(
  `[｜|]《|《《([^《》\\n]+)》》|[｜|]([^｜|《》\\n]{1,20})《([^《》\\n]{1,50})》|([${KANJI}]{1,20})《([^《》\\n]{1,50})》`,
  "gu",
);

export interface NotationPart {
  kind: "text" | "ruby" | "dots";
  /** 表示する文字(ルビの場合は親文字) */
  text: string;
  ruby?: string;
  /** 記法のままの文字 */
  raw: string;
}

export function parseNotation(s: string): NotationPart[] {
  const out: NotationPart[] = [];
  let at = 0;
  for (const m of s.matchAll(NOTATION)) {
    if (m.index > at) out.push({ kind: "text", text: s.slice(at, m.index), raw: s.slice(at, m.index) });
    at = m.index + m[0].length;
    if (m[1] !== undefined) out.push({ kind: "dots", text: m[1], raw: m[0] });
    else if (m[2] !== undefined) out.push({ kind: "ruby", text: m[2], ruby: m[3], raw: m[0] });
    else if (m[4] !== undefined) out.push({ kind: "ruby", text: m[4], ruby: m[5], raw: m[0] });
    else out.push({ kind: "text", text: "《", raw: m[0] });
  }
  if (at < s.length) out.push({ kind: "text", text: s.slice(at), raw: s.slice(at) });
  return out;
}

/** 記法を取り除いた、読者に見える本文 */
export const stripNotation = (s: string) => parseNotation(s).map((p) => p.text).join("");

/** 段落の先頭を下げない行(セリフなどの括弧や、見出しの◇で始まる行) */
export const isNoIndentLine = (line: string) => /^(?:[「『（(【〈“◇]|《(?!《))/.test(line);

/** 地の文の行頭を全角1文字下げる */
export function indentParagraphs(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const t = line.replace(/^[ 　]+/, "");
      return !t || isNoIndentLine(t) ? t : `　${t}`;
    })
    .join("\n");
}

export interface AutoRuby {
  /** 空白を除いた語 */
  word: string;
  /** 空なら、この語にはルビを付けない */
  ruby: string;
  pattern: string;
  /** この語が出てきたら、初出を済ませたことにする語(氏名に対する姓・名) */
  covers: string[];
}

const SPACES = /[ 　]+/;
const compact = (s: string) => s.replace(/[ 　]/g, "");
const hasKanji = (s: string) => new RegExp(`[${KANJI}]`, "u").test(s);
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patternOf = (word: string) => word.trim().split(SPACES).map(escapeRegExp).join("[ 　]?");

/**
 * 自動で付けるルビの一覧。先に書いたものを優先する。
 * 人物の読みは漢字を含む名前だけが対象で、1文字の名前や姓・名は別の語と紛れやすいので対象にしない。
 */
export function buildRubyRules(special: RubyRule[], people: { name: string; reading: string }[]): AutoRuby[] {
  const rules = new Map<string, AutoRuby>();
  const add = (name: string, reading: string, covers: string[] = []) => {
    const word = compact(name);
    const ruby = compact(reading);
    if (!word || rules.has(word) || [...word].length > 20 || [...ruby].length > 50 || ruby === word) return;
    rules.set(word, { word, ruby, pattern: patternOf(name), covers });
  };
  for (const r of special) add(r.word, r.ruby);
  for (const p of people) {
    const name = p.name.trim();
    const reading = p.reading.trim();
    if (!reading) continue;
    const names = name.split(SPACES);
    const readings = reading.split(SPACES);
    const pairs = names.length > 1 && names.length === readings.length ? names.map((n, i) => [n, readings[i]]) : [];
    const usable = ([n]: string[]) => hasKanji(n) && [...n].length >= 2;
    if (usable([compact(name)])) add(name, reading, pairs.map(([n]) => n));
    for (const pair of pairs) if (usable(pair)) add(pair[0], pair[1]);
  }
  return [...rules.values()];
}

const scriptOf = (c: string | undefined) => {
  if (!c) return "";
  if (new RegExp(`[${KANJI}]`, "u").test(c)) return "kanji";
  if (/[\p{Script=Katakana}ー]/u.test(c)) return "katakana";
  return /[0-9A-Za-z０-９Ａ-Ｚａ-ｚ]/.test(c) ? "latin" : "";
};

/** 「大魔王」の中の「魔王」のように、長い語の一部なら別の語とみなす。「星野先輩」のような敬称は除く */
function isWholeWord(word: string, before: string | undefined, after: string): boolean {
  const first = scriptOf([...word][0]);
  const last = scriptOf([...word].at(-1));
  if (first && first === scriptOf(before)) return false;
  return !last || last !== scriptOf([...after][0]) || /^(?:様|君|氏|殿|嬢|先輩|先生)/.test(after);
}

/**
 * 語の初出にルビを付ける。seen を渡すと、複数の文章にまたがって初出を判定する。
 * すでに記法で書かれた箇所と、《》で囲まれた文字は書き換えない。
 */
export function withRubies(text: string, rules: AutoRuby[], seen = new Set<string>()): string {
  if (!rules.length) return text;
  const byWord = new Map(rules.map((r) => [r.word, r]));
  const mark = (r: AutoRuby) => [r.word, ...r.covers].forEach((w) => seen.add(w));
  const patterns = rules.map((r) => r.pattern).sort((a, b) => b.length - a.length);
  const re = new RegExp(`《[^《》\\n]*》|${patterns.join("|")}`, "gu");
  return parseNotation(text)
    .map((part) => {
      if (part.kind === "ruby") {
        const r = byWord.get(compact(part.text));
        if (r) mark(r);
      }
      if (part.kind !== "text" || part.raw !== part.text) return part.raw;
      return part.text.replace(re, (m: string, at: number) => {
        const r = byWord.get(compact(m));
        if (!r || !isWholeWord(m, part.text[at - 1], part.text.slice(at + m.length, at + m.length + 2))) return m;
        const first = !seen.has(r.word);
        mark(r);
        return first && r.ruby ? `｜${m}《${r.ruby}》` : m;
      });
    })
    .join("");
}
