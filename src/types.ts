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
}

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
}

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
  /** 新しく追加する話の規模の既定値 */
  plan: { scenes: number; charsPerScene: number };
  episodes: Story[];
}

export type Doc = Story | Anthology;

export function isAnthology(d: Doc | null | undefined): d is Anthology {
  return (d as Anthology | null)?.kind === "anthology";
}

export interface StorySummary {
  /** 以前のバージョンの一覧データでは欠けていることがある */
  kind?: "novel" | "anthology";
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
}

export const DEFAULT_SETTINGS: Settings = {
  ollamaUrl: "http://127.0.0.1:11434",
  model: "",
  temperature: 0.8,
  numCtx: 16384,
  author: "",
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
