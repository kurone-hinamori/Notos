import { invoke } from "@tauri-apps/api/core";
import type { Anthology, AnthologyMode, Concept, Doc, EntryKind, Settings, SharedCharacter, SharedEntry, Story, StorySummary } from "../types";
import { DEFAULT_PLAN, DEFAULT_SETTINGS, emptyBible } from "../types";
import { newId } from "./text";

export const listStories = () => invoke<StorySummary[]>("list_stories");
export const loadStory = (id: string) => invoke<Doc>("load_story", { id });
export const saveStory = (story: Doc) => invoke<void>("save_story", { story });
export const deleteStory = (id: string) => invoke<void>("delete_story", { id });

export function createStory(concept: Concept, keywords: string[], author: string, note = "", lines: string[] = []): Story {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    keywords,
    note,
    lines,
    title: concept.title,
    tagline: concept.tagline,
    genre: concept.genre,
    synopsis: concept.synopsis,
    characters: concept.characters,
    status: "concept",
    bible: emptyBible(),
    chapters: [],
    plan: { ...DEFAULT_PLAN },
    author,
  };
}

export const BLANK_CONCEPT: Concept = { title: "", tagline: "", genre: "", synopsis: "", characters: [] };

/** 短編集の1話分の空の枠を作る(概要はガチャで決める)。 */
export function createEpisode(a: Pick<Anthology, "keywords" | "note" | "author" | "plan">): Story {
  const s = createStory(BLANK_CONCEPT, [...a.keywords], a.author, a.note);
  s.form = "short";
  s.plan = { chapters: 1, scenes: a.plan.scenes, charsPerScene: a.plan.charsPerScene };
  return s;
}

/** 概要が決まっていない話かどうか */
export const isUndecided = (s: Story) => !s.title.trim() && !s.synopsis.trim();

export function createAnthology(opts: {
  title: string;
  keywords: string[];
  note: string;
  author: string;
  episodes: number;
  scenes: number;
  charsPerScene: number;
  mode: AnthologyMode;
  world: string;
  cast: SharedCharacter[];
  shared: Partial<Record<EntryKind, SharedEntry[]>>;
}): Anthology {
  const now = new Date().toISOString();
  const base = { keywords: opts.keywords, note: opts.note, author: opts.author, plan: { scenes: opts.scenes, charsPerScene: opts.charsPerScene } };
  return {
    version: 1,
    kind: "anthology",
    id: newId(),
    createdAt: now,
    updatedAt: now,
    title: opts.title,
    ...base,
    mode: opts.mode,
    world: opts.world,
    cast: opts.cast,
    shared: opts.shared,
    autoConcept: true,
    stopOnIssues: false,
    episodes: Array.from({ length: opts.episodes }, () => createEpisode(base)),
  };
}

const SETTINGS_KEY = "notos.settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* 既定値を使う */
  }
  return { ...DEFAULT_SETTINGS };
}

export function persistSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* 保存できなくても動作は継続する */
  }
}
