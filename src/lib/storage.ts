import { invoke } from "@tauri-apps/api/core";
import type { Concept, Settings, Story, StorySummary } from "../types";
import { DEFAULT_PLAN, DEFAULT_SETTINGS, emptyBible } from "../types";
import { newId } from "./text";

export const listStories = () => invoke<StorySummary[]>("list_stories");
export const loadStory = (id: string) => invoke<Story>("load_story", { id });
export const saveStory = (story: Story) => invoke<void>("save_story", { story });
export const deleteStory = (id: string) => invoke<void>("delete_story", { id });

export function createStory(concept: Concept, keywords: string[], author: string): Story {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    keywords,
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
