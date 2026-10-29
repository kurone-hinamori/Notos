export interface CharacterOutline {
  name: string;
  role: string;
  summary: string;
}

/** ガチャで提示される物語の概要 */
export interface Concept {
  title: string;
  tagline: string;
  genre: string;
  synopsis: string;
  characters: CharacterOutline[];
}

export interface CharacterSheet {
  name: string;
  reading: string;
  role: string;
  age: string;
  appearance: string;
  personality: string;
  speech: string;
  background: string;
  relations: string;
  /** 本文の執筆中に判明した追加情報 */
  notes: string;
  /** セリフの括弧。念話で話す人ならざる存在は『』など。未設定は「」 */
  bracket?: SpeechBracket;
}

export type SpeechBracket = "「」" | "『』" | "【】";
export const SPEECH_BRACKETS: SpeechBracket[] = ["「」", "『』", "【】"];

export interface Entry {
  name: string;
  description: string;
  /** 本文の執筆中に判明した追加情報 */
  notes: string;
}

/** 設定資料 */
export interface Bible {
  generated: boolean;
  premise: string;
  worldview: string;
  /** 文体指針(視点・時制・口調など) */
  style: string;
  timeline: string;
  characters: CharacterSheet[];
  places: Entry[];
  items: Entry[];
  terms: Entry[];
}

export interface Issue {
  /** 本文中の該当箇所(原文のまま) */
  quote: string;
  problem: string;
  replacement: string;
  applied: boolean;
  /** 利用者による扱い。done: 対応済み、ignored: 無視(誤検出など) */
  state?: "done" | "ignored";
}

export interface Chapter {
  title: string;
  /** 章のあらすじ(構成) */
  plan: string;
  /** 場面ごとの展開 */
  beats: string[];
  body: string;
  /** 執筆済みの場面数 */
  sceneDone: number;
  /** 章の要約(以降の章の執筆時に前提として渡す) */
  digest: string;
  proofread: boolean;
  issues: Issue[];
  /** この章で使うセリフと、使う場面(0始まり) */
  lines?: { text: string; scene: number }[];
  /** この章の途中で手に入れる共通の品物と、手に入れる場面(0始まり) */
  acquire?: { name: string; scene: number }[];
  /** カクヨム連載:場面(=連載1回分)ごとのサブタイトル */
  sceneTitles?: string[];
}

export type StoryStatus = "concept" | "producing" | "done";

export interface BookPlan {
  chapters: number;
  scenes: number;
  charsPerScene: number;
}

export interface Story {
  version: 1;
  id: string;
  /** "short" は短編集の1話(1章で完結する短編) */
  form?: "novel" | "short";
  createdAt: string;
  updatedAt: string;
  keywords: string[];
  /** ガチャを引いたときの補足の希望 */
  note?: string;
  title: string;
  tagline: string;
  genre: string;
  synopsis: string;
  characters: CharacterOutline[];
  status: StoryStatus;
  bible: Bible;
  chapters: Chapter[];
  plan: BookPlan;
  author: string;
  /** 使ってほしいセリフ(1件ずつ。本文のどこかで必ず使う) */
  lines?: string[];
  /** 短編集の話で、概要が未決定のうちに決めておくタイトル(おまかせ生成で使う) */
  plannedTitle?: string;
  /** 短編集の話で、出演させる共通の登場人物の id */
  castIds?: string[];
  /** 短編集の話を生成するとき、短編集側から渡される共有情報(生成の直前に設定される) */
  shared?: SharedContext;
}

/** 短編集の共通の登場人物。話をまたいで同一人物として扱う。 */
export interface SharedCharacter extends CharacterSheet {
  id: string;
  /** 話ごとの経緯(連作短編で、後の話に引き継ぐ) */
  history: { episodeId: string; text: string }[];
}

export type EntryKind = "places" | "items" | "terms";

/** 短編集の共通の設定(場所・品物・用語)。全話で同じものとして扱う。 */
export interface SharedEntry extends Entry {
  id: string;
  /** 話ごとの経緯(連作短編で、後の話に引き継ぐ) */
  history: { episodeId: string; text: string }[];
  /** 登場する最初の話。これより前の話には渡さない。未設定は最初の話から */
  fromEpisodeId?: string;
  /** 品物のみ:登場する最初の話での状態。start: 最初から持っている、during: その話の途中で手に入れる。未設定は start */
  acquire?: "start" | "during";
  /** 品物のみ:途中で手に入れる場合の場面。auto: 構成の作成時に決める、last: 最後の場面。未設定は auto */
  acquireAt?: "auto" | "last";
  /** 登場・入手の条件(任意) */
  condition?: string;
}

/** 各話に渡す共通の設定(場所・品物・用語)1件 */
export interface SharedEntryContext {
  kind: EntryKind;
  name: string;
  description: string;
  history: string;
  /** owned: 話の最初からある、acquire: この話の途中で手に入れる。未設定は owned */
  status?: "owned" | "acquire";
  /** acquire の場合、最後の場面で手に入れるかどうか */
  acquireAt?: "auto" | "last";
  condition?: string;
}

/** 短編集から各話へ渡す情報 */
export interface SharedContext {
  /** 出演する共通の登場人物(経緯はその話より前のものだけ) */
  characters: (CharacterSheet & { history: string })[];
  /** 共通の場所・品物・用語(経緯はその話より前のものだけ)。以前のデータには無いことがある */
  entries?: SharedEntryContext[];
  /** 共通の世界観 */
  world: string;
  /** 他の話で使われている名前(同名の別人を避ける) */
  avoidNames: string[];
  /** 連作短編の場合、これまでの話の流れ */
  previous: string;
  /** カクヨム連載の場合、この話の位置と1回分の長さ */
  serial?: {
    index: number;
    total: number;
    scenes: number;
    chars: number;
    /** 前の話の本文の末尾(この話の書き出しを自然につなげるため) */
    prevTail?: string;
  };
}

/** カクヨムに掲載するための情報 */
export interface KakuyomuInfo {
  /** キャッチコピー(35文字まで) */
  catchcopy: string;
  /** 紹介文 */
  introduction: string;
  /** タグ(8個まで) */
  tags: string[];
}

export const KAKUYOMU_CATCHCOPY_MAX = 35;
export const KAKUYOMU_TAGS_MAX = 8;
/** 必ず付けるタグ(カクヨムでは、AIで本文を作った作品に必須) */
export const KAKUYOMU_FIXED_TAGS = ["AI本文利用"];

/** 固定のタグを先頭に入れ、重複を除いたタグの並び */
export function withFixedTags(tags: string[]): string[] {
  return [...KAKUYOMU_FIXED_TAGS, ...tags.filter((t) => !KAKUYOMU_FIXED_TAGS.includes(t))];
}
/** 連載1回分の文字数の目安 */
export const KAKUYOMU_POST_MIN = 2000;
export const KAKUYOMU_POST_MAX = 2500;

export type AnthologyMode = "series" | "omnibus";

/** 短編集。各話は1章構成の独立した Story として持つ。 */
export interface Anthology {
  version: 1;
  kind: "anthology";
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  /** 全話に共通するキーワード(各話のガチャの初期値になる) */
  keywords: string[];
  note: string;
  author: string;
  /** 全話に共通するジャンル。空の場合は、話ごとにガチャで決まる */
  genre?: string;
  /** 新しく追加する話の規模の既定値 */
  plan: { scenes: number; charsPerScene: number };
  episodes: Story[];
  /** series: 連作短編(共通の人物・世界で話の順に時間が進む)、omnibus: 各話が独立。未設定は omnibus */
  mode?: AnthologyMode;
  /** 共通の世界観・舞台 */
  world?: string;
  /** 共通の登場人物 */
  cast?: SharedCharacter[];
  /** 共通の場所・品物・用語 */
  shared?: Partial<Record<EntryKind, SharedEntry[]>>;
  /** まとめて生成で、概要が未決定の話のあらすじを自動で作る(おまかせ)。未設定は true */
  autoConcept?: boolean;
  /** まとめて生成で、「要確認」が残った話があれば次の話へ進まずに止まる。未設定は false */
  stopOnIssues?: boolean;
  /** kakuyomu: カクヨム連載(連作短編をもとに、話=章、場面=連載1回分として扱う)。未設定は短編集 */
  format?: "anthology" | "kakuyomu";
  /** カクヨム連載の掲載情報 */
  kakuyomu?: KakuyomuInfo;
}

export type Doc = Story | Anthology;

export function isAnthology(d: Doc | null | undefined): d is Anthology {
  return (d as Anthology | null)?.kind === "anthology";
}

export interface StorySummary {
  /** 以前のバージョンの一覧データでは欠けていることがある */
  kind?: "novel" | "anthology";
  /** 短編集の場合の形式(kakuyomu: カクヨム連載) */
  format?: "anthology" | "kakuyomu";
  /** 短編集の場合、完成した話の数 */
  doneCount: number;
  id: string;
  title: string;
  tagline: string;
  synopsis: string;
  keywords: string[];
  status: StoryStatus;
  createdAt: string;
  updatedAt: string;
  chapterCount: number;
  charCount: number;
}

export interface Settings {
  ollamaUrl: string;
  model: string;
  temperature: number;
  numCtx: number;
  author: string;
  /** 本文の文字の大きさ(px) */
  bodyFontSize: number;
  /** 本文の数字の表記の統一(校閲のときに適用する) */
  numberStyle: "kanji" | "arabic" | "none";
}

export const DEFAULT_SETTINGS: Settings = {
  ollamaUrl: "http://127.0.0.1:11434",
  model: "",
  temperature: 0.8,
  numCtx: 16384,
  author: "",
  bodyFontSize: 15,
  numberStyle: "kanji",
};

export const DEFAULT_PLAN: BookPlan = { chapters: 12, scenes: 4, charsPerScene: 2000 };

export function emptyBible(): Bible {
  return {
    generated: false,
    premise: "",
    worldview: "",
    style: "",
    timeline: "",
    characters: [],
    places: [],
    items: [],
    terms: [],
  };
}
