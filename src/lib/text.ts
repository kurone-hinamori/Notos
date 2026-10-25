import type { Bible, CharacterSheet, Entry, Story } from "../types";

/** 日本語の文字数(空白・改行を除く) */
export function countChars(text: string): number {
  return text.replace(/\s/g, "").length;
}

export function storyChars(story: Story): number {
  return story.chapters.reduce((n, c) => n + countChars(c.body), 0);
}

/** LLM 出力から前置き・コードフェンス・見出しなどを取り除き、段落を改行1つで区切った形に整える。 */
/**
 * モデルが文字をバイトのまま出力した「<0xE3><0x80><0x80>」のような文字列を、本来の文字に戻す。
 * 文字として成り立たない断片は取り除く。
 */
export function decodeByteTokens(text: string): { text: string; count: number } {
  let count = 0;
  const out = text.replace(/(?:<0x[0-9A-Fa-f]{2}>)+/g, (seq) => {
    count++;
    const bytes = Uint8Array.from(seq.match(/[0-9A-Fa-f]{2}(?=>)/g)!.map((h) => parseInt(h, 16)));
    return new TextDecoder("utf-8").decode(bytes).replace(/�/g, "");
  });
  return { text: out, count };
}

export function cleanProse(raw: string): string {
  let t = decodeByteTokens(raw.replace(/\r\n?/g, "\n")).text.trim();
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
  if (norm(a) === norm(b)) return true;
  // 片方にだけ末尾の補足の括弧が付いている場合(例:「銀の懐中時計(先代からのもの)」)は同じものとみなす。
  // 両方に括弧がある場合(「田中(父)」「田中(母)」)は別物の可能性があるので区別する。
  const paren = /[（(][^（()）]*[）)]\s*$/;
  if (paren.test(a) === paren.test(b)) return false;
  return norm(a.replace(paren, "")) === norm(b.replace(paren, ""));
}

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

/** 「使ってほしいセリフ」の入力(1行に1つ)を配列にする。 */
export function parseLines(text: string): string[] {
  return [...new Set(text.split("\n").map((l) => l.trim()).filter(Boolean))];
}

/**
 * 指定されたセリフの、本文に現れるべき中身を取り出す。括弧は「」『』【】のどれでもよい。
 * アリア「任せて」のように話者付きで書かれた場合は、括弧の中だけを使う。
 * 「アリア「任せて」」のように全体をさらに囲んである場合も、いちばん内側のセリフを取り出す。
 */
export function lineCore(line: string): string {
  // 括弧を含まない(=いちばん内側の)括弧の中身
  const m = line.match(/[「『【]([^「『【」』】]+)[」』】]/);
  return (m ? m[1] : line.replace(/[「『【」』】]/g, "")).trim();
}

/** 指定されたセリフの括弧(いちばん内側)。括弧が書かれていなければ null */
export function lineBracket(line: string): { open: string; close: string } | null {
  const m = line.match(/([「『【])[^「『【」』】]+([」』】])/);
  return m ? { open: m[1], close: m[2] } : null;
}

/** 指定されたセリフを、本文に現れるべき形(括弧つき)にする。括弧の指定がなければ「」 */
export function lineQuoted(line: string): string {
  const b = lineBracket(line) ?? { open: "「", close: "」" };
  return `${b.open}${lineCore(line)}${b.close}`;
}

/**
 * 本文で、指定のセリフが指定の括弧で書かれているか。
 * true: 指定どおり、false: 別の括弧で書かれている、null: 判定できない(括弧の指定がない・本文にそのままの形がない)
 */
export function lineBracketOk(body: string, line: string): boolean | null {
  const b = lineBracket(line);
  const core = lineCore(line);
  const at = core ? body.indexOf(core) : -1;
  if (!b || at < 0) return null;
  const before = body.slice(Math.max(0, at - 60), at);
  const opens = ["「", "『", "【"].map((c) => ({ c, i: before.lastIndexOf(c) })).filter((x) => x.i >= 0);
  if (!opens.length) return null;
  const nearest = opens.reduce((x, y) => (y.i > x.i ? y : x));
  return nearest.c === b.open;
}

/** 空白と、句読点・記号・括弧の違いを無視して比べるための正規化 */
const squash = (s: string) => s.replace(/[\s　、。,.，．!?！？…‥・･―—─\-~〜～「」『』【】（）()]/g, "");

/**
 * 本文の中で指定のセリフが現れる位置(正規化した本文での位置)。無ければ -1。
 * 【草】のような2文字以下の短いセリフは、「草原」などに紛れないよう、括弧ごと一致したものだけを数える。
 */
export function linePos(body: string, line: string): number {
  const core = squash(lineCore(line));
  if (!core) return -1;
  if ([...core].length <= 2) {
    const raw = lineCore(line);
    const hits = ["「", "『", "【"]
      .map((o) => body.indexOf(o + raw + ({ "「": "」", "『": "』", "【": "】" } as Record<string, string>)[o]))
      .filter((i) => i >= 0);
    return hits.length ? squash(body.slice(0, Math.min(...hits))).length : -1;
  }
  return squash(body).indexOf(core);
}

/** 本文に指定のセリフが(空白と句読点・記号の違いを除いて)そのまま入っているか */
export function hasLine(body: string, line: string): boolean {
  return linePos(body, line) >= 0;
}
