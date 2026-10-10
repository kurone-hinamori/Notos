// Ollama の構造化出力(JSON Schema)定義

type Schema = Record<string, unknown>;

const str: Schema = { type: "string" };
const arr = (items: Schema): Schema => ({ type: "array", items });
const obj = (properties: Record<string, Schema>): Schema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
});

const characterSheet = obj({
  name: str,
  reading: str,
  role: str,
  age: str,
  appearance: str,
  personality: str,
  speech: str,
  background: str,
  relations: str,
});

const entry = obj({ name: str, description: str });

export const conceptSchema = obj({
  title: str,
  tagline: str,
  genre: str,
  synopsis: str,
  characters: arr(obj({ name: str, role: str, summary: str })),
});

export const bibleSchema = obj({
  premise: str,
  worldview: str,
  style: str,
  timeline: str,
  characters: arr(characterSheet),
  places: arr(entry),
  items: arr(entry),
  terms: arr(entry),
});

export const outlineSchema = obj({
  chapters: arr(obj({ title: str, plan: str, beats: arr(str) })),
  // 使ってほしいセリフを、どの章のどの場面で使うか(番号は1始まり)
  lineScenes: arr(obj({ line: str, chapter: { type: "integer" }, scene: { type: "integer" } })),
});

export const digestSchema = obj({ digest: str });

/** 本文から抽出した設定資料への追記 */
export const bibleUpdateSchema = obj({
  characters: arr(obj({ ...(characterSheet.properties as Record<string, Schema>), notes: str })),
  places: arr(obj({ name: str, description: str, notes: str })),
  items: arr(obj({ name: str, description: str, notes: str })),
  terms: arr(obj({ name: str, description: str, notes: str })),
});

export const issuesSchema = obj({
  issues: arr(obj({ quote: str, problem: str, replacement: str })),
});

/** 短編集の共通の登場人物(と世界観)の案 */
export const castSchema = obj({
  world: str,
  characters: arr(characterSheet),
});

/** 1話の中で共通の登場人物に起きた変化 */
export const castChangesSchema = obj({
  changes: arr(obj({ name: str, change: str })),
});

/** 短編集の共通の設定(場所・品物・用語)の案 */
export const entriesSchema = obj({
  entries: arr(entry),
});
