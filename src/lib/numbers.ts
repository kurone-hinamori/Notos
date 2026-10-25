// 本文の数字の表記(漢数字/算用数字)を機械的に統一する。
// LLM に任せると「一瞬」「十分(じゅうぶん)」のような語まで書き換えるおそれがあるので、規則で変換する。

export type NumberStyle = "kanji" | "arabic" | "none";

const KANJI_DIGITS = "〇一二三四五六七八九";
const SMALL_UNITS: [string, number][] = [
  ["千", 1000],
  ["百", 100],
  ["十", 10],
];
const BIG_UNITS: [string, bigint][] = [
  ["兆", 1000000000000n],
  ["億", 100000000n],
  ["万", 10000n],
];

/** 算用数字を位取りの漢数字にする(例:3000 → 三千、12500 → 一万二千五百) */
export function toKanjiNumber(n: bigint): string {
  if (n === 0n) return "〇";
  const under10000 = (v: number) => {
    let out = "";
    for (const [ch, unit] of SMALL_UNITS) {
      const d = Math.floor(v / unit);
      if (d) out += (d === 1 ? "" : KANJI_DIGITS[d]) + ch;
      v %= unit;
    }
    return out + (v ? KANJI_DIGITS[v] : "");
  };
  let out = "";
  let rest = n;
  for (const [ch, unit] of BIG_UNITS) {
    const d = rest / unit;
    if (d) out += under10000(Number(d)) + ch;
    rest %= unit;
  }
  return out + under10000(Number(rest));
}

/** 算用数字を1字ずつ漢数字にする(例:2024 → 二〇二四) */
const toKanjiDigits = (s: string) => s.replace(/[0-9]/g, (d) => KANJI_DIGITS[Number(d)]);

/** 漢数字を数値にする(位取り「三千二百」と、1字ずつ「二〇二四」の両方に対応) */
export function parseKanjiNumber(s: string): bigint | null {
  if (!/^[〇零一二三四五六七八九十百千万億兆]+$/.test(s)) return null;
  // 位を表す字がなければ、1字ずつの書き方
  if (!/[十百千万億兆]/.test(s)) return BigInt(s.replace(/./g, (c) => String(KANJI_DIGITS.indexOf(c === "零" ? "〇" : c))));
  let total = 0n;
  let section = 0n;
  let digit = -1;
  for (const c of s) {
    const d = KANJI_DIGITS.indexOf(c === "零" ? "〇" : c);
    if (d >= 0) {
      // 「三〇〇〇万」のように、単位の前が1字ずつの数になっている場合もある
      digit = digit < 0 ? d : digit * 10 + d;
      continue;
    }
    const small = SMALL_UNITS.find(([ch]) => ch === c);
    if (small) {
      section += BigInt(digit < 0 ? 1 : digit) * BigInt(small[1]);
      digit = -1;
      continue;
    }
    const big = BIG_UNITS.find(([ch]) => ch === c)!;
    section += BigInt(digit < 0 ? 0 : digit);
    total += (section || 1n) * big[1];
    section = 0n;
    digit = -1;
  }
  return total + section + BigInt(digit < 0 ? 0 : digit);
}

const toHalf = (s: string) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[，]/g, ",").replace(/[．]/g, ".");

/** 算用数字に統一するときに、数字のあとに付いていれば変換する単位 */
const COUNTERS =
  "円|歳|才|人|名|個|回|年|ヶ月|か月|カ月|月|日|時間|時|分|秒|階|メートル|キロ|グラム|センチ|ミリ|パーセント|%|％|枚|本|匹|頭|羽|冊|台|件|点|度|倍|番|位|号|話|章|部|杯|軒|通|発|歩|席|周|週|万|億";

/** 漢数字としての読みが慣用的な語(算用数字にしない) */
const IDIOMS = /^(十分(?:な|に|だ|で|す|と|過ぎ|すぎ)|百も承知|千載一遇|万が一|一石二鳥|十中八九|百発百中|四六時中|一日中|千差万別|十八番|百八十度)/;

/** 算用数字にするとき、万・億の区切りがちょうどの数は単位を残す(1000000 → 100万、40000000 → 4000万) */
function toArabicWithUnits(v: bigint): string {
  if (v >= 10000n && v % 10000n === 0n) {
    const oku = v / 100000000n;
    const man = (v % 100000000n) / 10000n;
    return `${oku ? `${oku}億` : ""}${man ? `${man}万` : ""}`;
  }
  return v.toString();
}

/**
 * 漢数字に統一するときの書き方。
 * - 万・億で割り切れる数は単位を使う(1000000 → 百万、30000000 → 三〇〇〇万、120000000 → 一億二〇〇〇万)
 * - 100以上のその他の数は1字ずつ(3000 → 三〇〇〇、5985519 → 五九八五五一九)
 * - 100未満の数は位取り(17 → 十七、30 → 三十)
 */
export function toKanjiStyle(v: bigint): string {
  // 単位の前の数:十・百・千ちょうどはその字、100未満は位取り、それ以外は1字ずつ
  const coef = (n: bigint) =>
    n === 10n ? "十" : n === 100n ? "百" : n === 1000n ? "千" : n < 100n ? toKanjiNumber(n) : toKanjiDigits(n.toString());
  if (v >= 10000n && v % 10000n === 0n) {
    const oku = v / 100000000n;
    const man = (v % 100000000n) / 10000n;
    return `${oku ? `${coef(oku)}億` : ""}${man ? `${coef(man)}万` : ""}`;
  }
  return v < 100n ? toKanjiNumber(v) : toKanjiDigits(v.toString());
}

/**
 * 単位(円・人・歳など)の付いた漢数字を探して置き換える。
 * 慣用的な語・おおよその数・分数・「万人(ばんにん)」・算用数字に続く漢数字などは対象にしない。
 */
function replaceKanjiWithCounters(text: string, fn: (kanji: string, v: bigint) => string | null): string {
  return text.replace(
    // 「数千万人」「何百年」「幾千」のようなおおよその数や、「1万人」のように算用数字に続く漢数字は変えない
    new RegExp(`(?<![〇零一二三四五六七八九十百千万億兆数何幾0-9０-９])([〇零一二三四五六七八九十百千万億兆]+)(?=(?:${COUNTERS}))`, "g"),
    (all, kanji: string, offset: number, whole: string) => {
      const rest = whole.slice(offset);
      if (IDIOMS.test(rest)) return all;
      // 「万人(ばんにん)」のように、位の字だけのものは変えない
      if (/^[万億兆]+$/.test(kanji)) return all;
      // 分数(百分の一)は変えない
      if (rest.slice(kanji.length).startsWith("分の")) return all;
      // 「十分」は、時間を表すことがはっきりしている場合(十分後・十分間など)だけ変える
      if (kanji === "十" && rest[1] === "分" && !/^十分(?:後|前|間|以上|以内|ほど|程|くらい|ぐらい|経|おき|ごと|毎)/.test(rest)) return all;
      const v = parseKanjiNumber(kanji);
      if (v === null) return all;
      return fn(kanji, v) ?? all;
    },
  );
}

/**
 * 本文の数字の表記を統一する。
 * protect に渡したセリフ(使ってほしいセリフ)の中は変えない。
 */
export function normalizeNumbers(text: string, style: NumberStyle, protect: string[] = []): { text: string; count: number } {
  if (style === "none" || !text) return { text, count: 0 };
  // 守るセリフを一時的に置き換えておく
  const kept: string[] = [];
  let work = text;
  for (const p of protect.filter(Boolean).sort((a, b) => b.length - a.length)) {
    work = work.split(p).join(`\u0000${kept.push(p) - 1}\u0000`);
  }
  let count = 0;

  if (style === "kanji") {
    // 英字と組み合わさった語(MP3、2D など)や、時刻・小数の区切りに挟まれたものは変えない
    work = work.replace(
      /(?<![A-Za-zＡ-Ｚａ-ｚ0-9０-９.,，．:：\u0000])([0-9０-９]+(?:[,，][0-9０-９]{3})*(?:[.．][0-9０-９]+)?)(?![A-Za-zＡ-Ｚａ-ｚ0-9０-９:：\u0000])([%％]?)(年?)/g,
      (all, num: string, pct: string, year: string) => {
        const half = toHalf(num).replace(/,/g, "");
        let kanji: string;
        if (half.includes(".")) {
          const [i, f] = half.split(".");
          kanji = `${toKanjiNumber(BigInt(i))}・${toKanjiDigits(f)}`;
        } else if ((year && half.length === 4) || (half.length > 1 && half.startsWith("0")) || half.length > 16) {
          // 西暦・先頭が0の番号・桁の多い数は1字ずつ
          kanji = toKanjiDigits(half);
        } else {
          kanji = toKanjiStyle(BigInt(half));
        }
        count++;
        return kanji + (pct ? "パーセント" : "") + year;
        void all;
      },
    );
    // すでに漢数字で書かれている数(三千円など)も、同じ書き方(三〇〇〇円)にそろえる。
    // 「百年」「千円」のような1字だけのものは、語として使われていることが多いのでそのままにする。
    work = replaceKanjiWithCounters(work, (kanji, v) => {
      if (v < 100n || /^[百千]$/.test(kanji)) return null;
      const next = toKanjiStyle(v);
      if (next === kanji) return null;
      count++;
      return next;
    });
  } else {
    work = replaceKanjiWithCounters(work, (kanji, v) => {
      // 10未満で位の字を含まない数(「一人」「三日」など)は漢数字のままにする
      if (v < 10n && !/[十百千万億兆]/.test(kanji)) return null;
      count++;
      return toArabicWithUnits(v);
    });
  }
  work = work.replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)]);
  return { text: work, count };
}

export const NUMBER_STYLE_LABEL: Record<NumberStyle, string> = {
  kanji: "漢数字に統一(縦書き・EPUB向け)",
  arabic: "算用数字に統一(横書き・Web掲載向け)",
  none: "統一しない",
};
