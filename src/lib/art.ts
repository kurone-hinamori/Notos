import type { ArtBox, ArtImage, ArtItem, ArtKind, ArtSet, CharacterSheet, Doc } from "../types";
import { isAnthology } from "../types";
import { loadArt } from "./storage";
import { newId, sameName, splitScenes } from "./text";

export interface ArtKindInfo {
  label: string;
  desc: string;
  /** 生成の大きさ。16の倍数で、MOSS-Image の推奨の範囲(1〜2MP) */
  width: number;
  height: number;
  /** 仕上がりの大きさ */
  final?: [number, number];
  /** 白黒にする */
  mono?: boolean;
  /** 画像の種類ごとの説明(プロンプトの先頭に入れる) */
  frame: string;
  /** 1枚だけの種類は false */
  many: boolean;
  /** 場所を選ぶ。scene は挿入する場面まで選ぶ */
  place?: "chapter" | "scene";
  /** 採用した画像を EPUB に入れる */
  inBook: boolean;
  /** 人物を選んで描く */
  people: boolean;
}

/** KDP の推奨(縦横比 1.6、長辺 2560px)に合わせる */
const PAGE = { width: 1040, height: 1664 };

export const ART_KINDS: Record<ArtKind, ArtKindInfo> = {
  sheet: {
    label: "キャラクターシート",
    desc: "人物の外見を決めます。ここで決めた外見の説明を、ほかの画像に使います。本には入りません。",
    width: 1536,
    height: 1024,
    frame: "Character design reference sheet on a plain white background: the same person shown in a full-body front view, a full-body side view, a full-body back view, and a close-up of the face.",
    many: true,
    inBook: false,
    people: false,
  },
  cover: {
    label: "表紙",
    desc: "Kindle の表紙です(1600×2560)。題名と著者名は、文字の枠を置いて絵の中に描くか、枠がなければ保存のときに画像の上に重ねます。",
    ...PAGE,
    final: [1600, 2560],
    frame: "Book cover illustration with one clear focal point, leaving calm open space in the upper part of the frame.",
    many: false,
    inBook: true,
    people: true,
  },
  frontispiece: {
    label: "カラー口絵",
    desc: "題名のページの後に入るカラーイラストです。",
    ...PAGE,
    final: [1200, 1920],
    frame: "Full-color frontispiece illustration for a novel showing a dramatic, memorable moment.",
    many: true,
    inBook: true,
    people: true,
  },
  cast: {
    label: "登場人物紹介",
    desc: "口絵の後に入る、人物を並べた絵です。",
    ...PAGE,
    final: [1200, 1920],
    frame: "Group illustration introducing the characters of a novel, all of them standing side by side in a full-body lineup on a simple background.",
    many: false,
    inBook: true,
    people: true,
  },
  map: {
    label: "地図",
    desc: "口絵の後に入る、舞台の地図です。文字は入りません。",
    width: 1536,
    height: 1024,
    final: [1920, 1280],
    frame: "Hand-drawn map of the story's world seen from above on aged parchment, with terrain and landmarks, no letters.",
    many: true,
    inBook: true,
    people: false,
  },
  chapter: {
    label: "章扉",
    desc: "章や話の見出しの前に入る白黒の絵です。",
    ...PAGE,
    final: [1200, 1920],
    mono: true,
    frame: "Black and white chapter title illustration for a novel, ink drawing with screentone shading, atmospheric, no color.",
    many: true,
    place: "chapter",
    inBook: true,
    people: true,
  },
  illustration: {
    label: "挿絵(白黒)",
    desc: "選んだ場面の後に入る白黒の絵です。",
    ...PAGE,
    final: [1200, 1920],
    mono: true,
    frame: "Black and white illustration for a novel, ink drawing with screentone shading, no color.",
    many: true,
    place: "scene",
    inBook: true,
    people: true,
  },
  promo: {
    label: "宣伝用(A+コンテンツ)",
    desc: "Amazon の作品ページに載せる横長の画像です(970×600)。本には入りません。",
    width: 1456,
    height: 896,
    final: [970, 600],
    frame: "Wide promotional banner illustration for a novel, cinematic composition.",
    many: true,
    inBook: false,
    people: true,
  },
  free: {
    label: "そのほかの画像",
    desc: "大きさを決めて自由に作ります。本には入りません。",
    width: 1024,
    height: 1024,
    frame: "",
    many: true,
    inBook: false,
    people: true,
  },
};

export const ART_KIND_ORDER: ArtKind[] = ["sheet", "cover", "frontispiece", "cast", "map", "chapter", "illustration", "promo", "free"];

export const DEFAULT_ART_STYLE = "Japanese anime light novel illustration, clean lineart, soft cel shading";

export const emptyArt = (): ArtSet => ({ style: DEFAULT_ART_STYLE, items: [] });

export function newArtItem(kind: ArtKind, title = ART_KINDS[kind].label): ArtItem {
  return { id: newId(), kind, title, prompt: "", characters: [], images: [] };
}

/** 作品に出てくる人物(共通の人物を先に並べ、同じ名前はまとめる) */
export function artCharacters(doc: Doc): CharacterSheet[] {
  const list = isAnthology(doc) ? [...(doc.cast ?? []), ...doc.episodes.flatMap((e) => e.bible.characters)] : doc.bible.characters;
  const out: CharacterSheet[] = [];
  for (const c of list) if (c.name.trim() && !out.some((x) => sameName(x.name, c.name))) out.push(c);
  return out;
}

export interface ArtPlace {
  key: string;
  label: string;
  scenes: string[];
}

/** 章扉や挿絵を入れられる場所(本文のある章・話) */
export function artPlaces(doc: Doc): ArtPlace[] {
  if (isAnthology(doc)) {
    return doc.episodes
      .map((e, i) => ({ key: e.id, label: `第${i + 1}話 ${e.title}`, scenes: splitScenes(e.chapters.map((c) => c.body).join("\n\n")) }))
      .filter((p) => p.scenes.length);
  }
  return doc.chapters
    .map((c, i) => ({ key: `ch${i}`, label: `第${i + 1}章 ${c.title}`, scenes: splitScenes(c.body) }))
    .filter((p) => p.scenes.length);
}

/** 人ではない登場人物(ロボット・動物・物など)のキャラクターシート。人が持った絵にならないようにする */
const THING_SHEET_FRAME =
  "Design reference sheet on a plain white background for a non-human character: the same character alone, shown in a front view, a side view, a back view, and a close-up. Keep exactly the same shape in every view and do not add arms, legs or a body that are not described. No people, no hands, nobody is holding it.";

/** 否定のプロンプトに足す語 */
export const artNegative = (item: ArtItem) => (item.kind === "sheet" && item.notHuman ? "person, human, girl, boy, hands, holding" : undefined);

const sheetOf = (art: ArtSet, name: string) => art.items.find((x) => x.kind === "sheet" && x.characters[0] === name);

/** 参照できるのは4枚まで(公式の説明による) */
const MAX_REFERENCES = 4;

/** シートの画像を参照するか。表紙は参照しないのが既定(参照すると明るく白っぽい絵柄になり、ディスプレイに顔が映り込むことがあった) */
export const usesReference = (item: ArtItem) => item.kind !== "sheet" && !(item.noReference ?? item.kind === "cover");

/** 描く人物。選んだ人物に、枠に置いた人物を足す */
export const drawnCharacters = (item: ArtItem) => {
  const out = [...item.characters];
  for (const b of item.layout ?? []) if (b.kind === "character" && b.name && !out.includes(b.name)) out.push(b.name);
  return out;
};

/** 参照する人物と、そのキャラクターシートの画像(file)。描く人物の順に並ぶ */
function referencedPeople(art: ArtSet, item: ArtItem): { name: string; file: string }[] {
  if (!usesReference(item)) return [];
  return drawnCharacters(item)
    .flatMap((name) => {
      const sheet = sheetOf(art, name);
      const file = sheet?.prompt.trim() ? chosenImage(sheet)?.file : undefined;
      return file ? [{ name, file }] : [];
    })
    .slice(0, MAX_REFERENCES);
}

export const artReferences = (art: ArtSet, item: ArtItem) => referencedPeople(art, item).map((x) => x.file);

const referenceLead = (n: number) =>
  n === 1
    ? "The reference image is a character design sheet. Draw this same character with the same face, hair, clothes and colors in a new single illustration. Do not copy the layout of the sheet."
    : `The reference images are character design sheets, one for each of Character 1 to Character ${n}, in the same order. Draw these same characters with the same faces, hair, clothes and colors in a new single illustration. Do not copy the layout of the sheets.`;

/** 参照するシートの絵柄に合わせる(表紙などが厚塗り・太い線のゲーム風になりやすかった) */
const referenceStyle = (mono: boolean) =>
  mono
    ? "Match the line art of the reference sheets: the same thin clean lines and the same way of drawing faces and eyes."
    : "Match the art style of the reference sheets exactly: the same thin clean line art, the same flat anime cel shading and the same natural coloring.";

const lookOf = (sheet: ArtItem) => (sheet.notHuman ? `(not a human, draw it as it is) ${sheet.prompt.trim()}` : sheet.prompt.trim());

/**
 * プロンプトの全文。画風、種類ごとの説明、説明文、人物の外見の順に並べる。
 * 参照するときも説明文を併用する(画像だけでは髪の長さなどが崩れた)。
 * 枠があれば MOSS-Image の JSON レイアウトにし、枠に置いた人物の外見はその枠の説明に入れる。
 */
export function fullArtPrompt(art: ArtSet, item: ArtItem): string {
  const k = ART_KINDS[item.kind];
  const frame = item.kind === "sheet" && item.notHuman ? THING_SHEET_FRAME : k.frame;
  const referenced = referencedPeople(art, item).map((x) => x.name);
  const boxes = item.kind === "sheet" ? [] : (item.layout ?? []).filter(validBox);
  const boxed = new Set(boxes.flatMap((b) => (b.kind === "character" && b.name ? [b.name] : [])));
  // 参照する人物を先に並べ、Character の番号と参照する画像の順番をそろえる
  const names = item.kind === "sheet" ? [] : [...referenced, ...drawnCharacters(item).filter((n) => !referenced.includes(n))];
  const numbered = names.filter((n) => sheetOf(art, n)?.prompt.trim());
  const label = (name: string) => (numbered.length > 1 ? `Character ${numbered.indexOf(name) + 1}` : "Character");
  // 人ではない登場人物(ロボット・動物など)は、そう明記して人の姿にされないようにする
  const people = numbered.filter((n) => !boxed.has(n)).map((n) => `${label(n)}: ${lookOf(sheetOf(art, n)!)}`);
  const hasText = boxes.some((b) => b.kind === "text");
  const summary = [
    referenced.length ? referenceLead(referenced.length) : "",
    art.style.trim(),
    frame,
    item.prompt.trim(),
    ...people,
    referenced.length ? referenceStyle(!!k.mono) : "",
    item.kind === "sheet" ? "Consistent design across all views, no text." : hasText ? "No other text than the text boxes." : "No text.",
  ]
    .filter(Boolean)
    .join("\n");
  if (!boxes.length) return summary;
  const [width, height] = item.size ?? [k.width, k.height];
  const items = boxes.map((b) => {
    const bbox = pixelBox(b.bbox, width, height);
    if (b.kind === "text") return { label: "text", caption: `${trimDot(b.caption) || "Text"}, ${placeOf(b.bbox)}.`, text: b.text ?? "", bbox };
    const sheet = b.kind === "character" && b.name ? sheetOf(art, b.name) : undefined;
    const look = sheet?.prompt.trim() ? `${label(b.name!)}: ${lookOf(sheet)}` : "";
    // ロボットや動物は object にする(character では人の姿にされやすい)
    return { label: b.kind === "character" && !sheet?.notHuman ? "character" : "object", caption: [b.caption.trim() ? `${trimDot(b.caption)}, ${placeOf(b.bbox)}.` : `${upper(placeOf(b.bbox))}.`, look].join(" ").trim(), bbox };
  });
  return JSON.stringify({ summary: { caption: summary }, items, bbox_coord_space: "abs_centralized", bbox_format: "yxyx" });
}

const trimDot = (t: string) => t.trim().replace(/[.。]+$/, "");
const upper = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * 枠の位置を言葉にする。小さい枠は位置だけでは守られず、
 * 右下に置いた著者名が題名の横に描かれたが、説明に「右下」と書くと守られた
 */
export function placeOf([y0, x0, y1, x1]: ArtBox["bbox"]): string {
  const third = (a: number, b: number, words: [string, string, string]) => {
    const c = (a + b) / 2;
    return c < 333 ? words[0] : c > 667 ? words[2] : words[1];
  };
  const v = third(y0, y1, ["top", "middle", "bottom"]);
  const h = third(x0, x1, ["left", "center", "right"]);
  if (v === "middle" && h === "center") return "placed in the center of the image";
  if (v === "middle") return `placed on the ${h} side of the image`;
  if (h === "center") return `placed at the ${v} center of the image`;
  return `placed at the ${v} ${h} corner of the image`;
}

/** 中身のある枠だけ使う */
const validBox = (b: ArtBox) => (b.kind === "text" ? !!b.text?.trim() : !!(b.caption.trim() || b.name));

/** 0〜1000 の [上, 左, 下, 右] を、画像の中心を原点にした画素に直す(ComfyUI の MOSS-Image Layout Prompt と同じ) */
export function pixelBox([y0, x0, y1, x1]: ArtBox["bbox"], width: number, height: number): number[] {
  const at = (v: number, size: number, round: (n: number) => number) => round(Math.round(((v * size) / 1000) * 1e9) / 1e9) - Math.floor(size / 2);
  return [at(y0, height, Math.floor), at(x0, width, Math.floor), at(y1, height, Math.ceil), at(x1, width, Math.ceil)];
}

/** 文字の枠の見た目の既定(日本語と英語) */
const TEXT_LOOKS: Record<NonNullable<ArtBox["role"]>, [string, string]> = {
  title: ["大きく太い白の題名ロゴ。黒い縁取り", "Large bold white Japanese title logo with a dark outline"],
  subtitle: ["題名の下の、少し小さい白い文字", "Smaller white Japanese subtitle text under the title, with a dark outline"],
  author: ["小さめの白い著者名", "Small white author name text with a thin dark outline, much smaller than the title"],
  free: ["白い文字。黒い縁取り", "White Japanese text with a dark outline"],
};

const box = (b: Omit<ArtBox, "id" | "captionFrom">): ArtBox => ({ ...b, id: newId(), captionFrom: b.captionJa });

export const textBox = (role: NonNullable<ArtBox["role"]>, text: string, bbox: ArtBox["bbox"]) =>
  box({ kind: "text", role, text, captionJa: TEXT_LOOKS[role][0], caption: TEXT_LOOKS[role][1], bbox });

/** 人物の枠(名前がなければ物の枠) */
export const thingBox = (kind: "character" | "object", name?: string): ArtBox =>
  box({ kind, name, captionJa: "", caption: "", bbox: kind === "character" ? [330, 250, 990, 750] : [350, 650, 500, 850] });

/** 題名を、題名とサブタイトルに分ける(「、」などの区切りがあり、長いときだけ) */
export function splitTitle(title: string): [string, string] {
  const t = title.trim();
  const m = t.length > 14 ? /^(.{4,}?)[、,，　 ](.+)$/.exec(t) : null;
  return m ? [m[1], breakLine(m[2])] : [t, ""];
}

/** 長いサブタイトルは、真ん中に近い助詞の後で2行に分ける(自動の改行は意図どおりにならないことがある) */
function breakLine(text: string): string {
  if (text.length <= 14 || text.includes("\n")) return text;
  const mid = text.length / 2;
  let best = -1;
  // 次の文字がひらがなでない所だけで分ける(「して|たら」のように語の途中で切らない)
  const kana = (c: string) => c >= "ぁ" && c <= "ゖ";
  for (let i = 3; i < text.length - 3; i++) if ("らてでにをがはのと、".includes(text[i]) && !kana(text[i + 1]) && (best < 0 || Math.abs(i + 1 - mid) < Math.abs(best + 1 - mid))) best = i;
  return best < 0 ? text : `${text.slice(0, best + 1)}\n${text.slice(best + 1)}`;
}

/** 表紙の題名・サブタイトル・著者名(右下)の枠 */
export function coverTextBoxes(title: string, author: string): ArtBox[] {
  const [main, sub] = splitTitle(title);
  const out = [textBox("title", main, [30, 60, 150, 940])];
  if (sub) out.push(textBox("subtitle", sub, [155, 120, 245, 880]));
  if (author.trim()) out.push(textBox("author", author.trim(), [920, 620, 970, 960]));
  return out;
}

export const chosenImage = (item: ArtItem): ArtImage | undefined => item.images.find((x) => x.file === item.chosen) ?? item.images.at(-1);

/** EPUB に入れる画像 */
export interface BookArt {
  cover?: string;
  front: string[];
  /** 場所ごとの章扉 */
  heads: Record<string, string>;
  /** 場所ごとの挿絵 */
  scenes: Record<string, { scene: number; file: string }[]>;
}

export function bookArtOf(art: ArtSet | undefined): BookArt {
  const out: BookArt = { front: [], heads: {}, scenes: {} };
  const items = (art?.items ?? []).filter((i) => ART_KINDS[i.kind].inBook && chosenImage(i));
  const file = (i: ArtItem) => chosenImage(i)!.file;
  out.cover = items.find((i) => i.kind === "cover") && file(items.find((i) => i.kind === "cover")!);
  for (const kind of ["frontispiece", "cast", "map"] as ArtKind[]) out.front.push(...items.filter((i) => i.kind === kind).map(file));
  for (const i of items) {
    if (!i.place) continue;
    if (i.kind === "chapter") out.heads[i.place] = file(i);
    if (i.kind === "illustration") (out.scenes[i.place] ??= []).push({ scene: i.scene ?? 0, file: file(i) });
  }
  return out;
}

const decode = (png: Uint8Array) => createImageBitmap(new Blob([png as BlobPart], { type: "image/png" }));

async function canvasOf(png: Uint8Array, filter?: string) {
  const bmp = await decode(png);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d")!;
  if (filter) ctx.filter = filter;
  ctx.drawImage(bmp, 0, 0);
  ctx.filter = "none";
  bmp.close();
  return { canvas, ctx };
}

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

/** 白黒の画像にする(MOSS-Image は「白黒」と指示しても色が残ることがあるため) */
export async function toGrayscale(png: Uint8Array): Promise<Uint8Array> {
  const { canvas } = await canvasOf(png, "grayscale(1)");
  return bytesOf(await canvas.convertToBlob({ type: "image/png" }));
}

/** 題名を横幅に収まるよう折り返す。行が多すぎれば文字を小さくする */
function layoutTitle(ctx: OffscreenCanvasRenderingContext2D, title: string, width: number, start: number): { size: number; lines: string[] } {
  for (let size = start; ; size = Math.round(size * 0.9)) {
    ctx.font = fontOf(size);
    const lines: string[] = [];
    let line = "";
    for (const ch of [...title]) {
      if (ctx.measureText(line + ch).width > width && line) {
        lines.push(line);
        line = "";
      }
      line += ch;
    }
    if (line) lines.push(line);
    if (lines.length <= 5 || size < start * 0.4) return { size, lines };
  }
}

const fontOf = (size: number) => `bold ${size}px "Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", serif`;

function outlined(ctx: OffscreenCanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  ctx.font = fontOf(size);
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(4, size * 0.14);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x, y);
}

/** JPEG にする。title を渡すと、表紙の上部に題名、下部に著者名を入れる */
export async function toJpeg(png: Uint8Array, text?: { title: string; author: string }): Promise<Uint8Array> {
  const { canvas, ctx } = await canvasOf(png);
  if (text) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const { size, lines } = layoutTitle(ctx, text.title, w * 0.86, Math.round(w * 0.085));
    lines.forEach((line, i) => outlined(ctx, line, w / 2, h * 0.05 + i * size * 1.25, size));
    if (text.author.trim()) {
      ctx.textBaseline = "bottom";
      outlined(ctx, text.author.trim(), w / 2, h * 0.96, Math.round(w * 0.045));
    }
  }
  return bytesOf(await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 }));
}

/** 表紙の題名と著者名を画像の上に重ねるか(文字の枠で絵の中に描いたなら、既定は重ねない) */
export const overlaysCoverText = (item: ArtItem) => item.coverText ?? !(item.layout ?? []).some((b) => b.kind === "text" && b.text?.trim());

/** 本やファイルに使う形にした画像(表紙は設定に応じて文字を入れる) */
export async function exportArtImage(doc: Doc, item: ArtItem | undefined, file: string, author: string): Promise<Uint8Array> {
  const png = await loadArt(doc.id, file);
  const text = item?.kind === "cover" && overlaysCoverText(item) ? { title: doc.title, author } : undefined;
  return toJpeg(png, text);
}
