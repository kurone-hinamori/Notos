import type { ChatMessage } from "./ollama";
import type { Bible, BookPlan, Story } from "../types";
import { bibleToText, tail } from "./text";

const EDITOR = "あなたは「小説家になろう」「カクヨム」で人気作を数多く手がけてきた、ライトノベル作家兼編集者です。";

export const STYLE_GUIDE = `【文体・執筆ルール】
- 「小説家になろう」「カクヨム」に載っているような、テンポが良く読みやすいライトノベルの文体で書く。
- 会話文は「」で囲み、会話ごとに改行する。地の文には適度に心理描写・情景描写を入れる。
- 一文を長くしすぎない。同じ語尾・同じ表現・同じ言い回しを連続させない。
- 視点と人称は設定資料の「文体指針」に従って一貫させる。途中で視点を混ぜない。
- 設定資料にある人物名・呼称・口調・外見・年齢・地名・品物の名称と設定を厳守する。既出の内容と矛盾させない。
- 新しい固有名詞・設定は必要最小限にとどめ、既出の設定と整合させる。
- 日本語として文法的に自然な文章にする。誤字脱字・助詞の誤り・主語の取り違えがないようにする。
- 段落は改行1つで区切る。段落の先頭に空白を入れない。
- 見出し、章題、箇条書き、記号による装飾、解説、前置き、あとがき、Markdownは一切出力しない。小説の本文のみを出力する。`;

const rand = () => Math.random().toString(36).slice(2, 8);

/** 短編集の1話として書く場合の目標文字数。長編なら undefined。 */
export type ShortSpec = { chars: number } | undefined;

const isShort = (s: Pick<Story, "form">) => s.form === "short";
const storyLength = (s: Story) => s.plan.chapters * s.plan.scenes * s.plan.charsPerScene;

export function conceptPrompt(keywords: string[], note: string, avoidTitles: string[], short?: ShortSpec): ChatMessage[] {
  const form = short
    ? `1話で完結する短編ライトノベル(約${short.chars.toLocaleString()}字)`
    : "長編ライトノベル(文庫本1冊分)";
  return [
    {
      role: "system",
      content: `${EDITOR}与えられたキーワードから、${form}の企画案を1つ考えます。出力はJSONのみ。`,
    },
    {
      role: "user",
      content: `次のキーワードをもとに、物語の概要を考えてください。

キーワード:${keywords.join("、")}
${note.trim() ? `補足の希望:${note.trim()}\n` : ""}
【条件】
- すべてのキーワードを物語の核として自然に取り入れる。
- 王道に収まらない、意外性のある切り口・設定にする(企画ID:${rand()})。
- title:Web小説らしくキャッチーで、内容が伝わるタイトル(40字以内)。
- tagline:読者の興味を引く一行キャッチコピー(40字以内)。
- genre:ジャンル(例:異世界ファンタジー、現代ラブコメ、ミステリー)。
${
  short
    ? `- 約${short.chars.toLocaleString()}字で書き切れる規模にする。登場人物と舞台を絞り、1つの出来事・1つの感情の変化を鮮やかに描く。
- synopsis:あらすじ。250〜400字。起承転結と結末まで含め、この1話で物語が完結するようにする。あらすじ中の`
    : "- synopsis:あらすじ。400〜600字。起承転結と、結末の方向性まで含める。あらすじ中の"
}人物名は、必ず characters に挙げた name と一字一句同じ表記にする(別名・愛称を使わない)。
- characters:${short ? "登場人物を2〜4名。主人公と、物語の鍵となる人物を含める。" : "登場人物を4〜6名。主人公、ヒロインまたは相棒、敵対者・黒幕などを含める。"}name は日本語表記の氏名、role は役割、summary は人物像を60〜100字で。
${avoidTitles.length ? `- 次の案とは内容もタイトルも被らないこと:${avoidTitles.join(" / ")}` : ""}`,
    },
  ];
}

function conceptText(s: Pick<Story, "title" | "tagline" | "genre" | "synopsis" | "characters" | "keywords">): string {
  return `タイトル:${s.title}
キャッチコピー:${s.tagline}
ジャンル:${s.genre}
キーワード:${s.keywords.join("、")}
あらすじ:${s.synopsis}
登場人物:
${s.characters.map((c) => `- ${c.name}(${c.role}):${c.summary}`).join("\n")}`;
}

export function biblePrompt(s: Story): ChatMessage[] {
  const short = isShort(s);
  return [
    {
      role: "system",
      content: `${EDITOR}物語を書き始める前に、全編を通して参照する詳細な設定資料を作成します。出力はJSONのみ。`,
    },
    {
      role: "user",
      content: `次の企画から、設定資料を作成してください。${short ? `これは約${storyLength(s).toLocaleString()}字の1話完結の短編です。短編に必要な分だけを簡潔に、しかし具体的に書いてください。` : ""}

${conceptText(s)}

【条件】
- premise:物語の前提・核となる謎や対立・結末の方向性を200〜300字で。
- worldview:世界観・舞台・時代・社会のルール(魔法や技術があればそのルール)を${short ? "150〜300字" : "300〜500字"}で。
- style:文体指針。視点(例:主人公の一人称/三人称一元視点)、時制、全体のトーン、会話と地の文の比率などを具体的に。
- timeline:物語の舞台設定上の時系列(物語開始時点までの重要な過去の出来事と、物語内の期間)。
- characters:企画の登場人物すべて(必要なら脇役も追加して${short ? "3〜6名" : "6〜10名"})。各人物について reading(読み仮名)、age、appearance(外見)、personality(性格)、speech(口調・一人称・二人称の呼び方の例)、background(経歴)、relations(他の人物との関係)を具体的に。
- places:物語の主要な地名・場所を${short ? "1〜4件" : "4〜8件"}。description に位置関係や特徴を。
- items:物語上重要な品物・道具・能力を${short ? "0〜3件" : "2〜6件"}。
- terms:固有の用語・組織・種族などを必要なだけ(なければ空配列)。
- 設定同士が矛盾しないこと。名前の表記は統一すること。`,
    },
  ];
}

export function outlinePrompt(s: Story, plan: BookPlan): ChatMessage[] {
  return [
    {
      role: "system",
      content: `${EDITOR}物語全体の章構成を設計します。出力はJSONのみ。`,
    },
    {
      role: "user",
      content: `${conceptText(s)}

【設定資料】
${bibleToText(s.bible)}

この物語の章構成を作ってください。${
        isShort(s)
          ? `これは約${storyLength(s).toLocaleString()}字の1話完結の短編なので、章は1つだけです。beats で導入・展開・山場・結末を組み立て、最後の場面で物語を完結させてください。`
          : ""
      }

【条件】
- 全${plan.chapters}章。chapters 配列の要素数を必ず${plan.chapters}にする。
- 各章は title(章題)、plan(その章のあらすじ。150〜250字)、beats(場面ごとの展開。要素数は必ず${plan.scenes}。各60〜120字で、具体的な出来事・会話の要点・感情の動きを書く)。
- 起承転結を意識し、前半で世界と人物を魅力的に提示し、中盤で状況を転換させ、終盤で伏線を回収して、最終章で物語を完結させる。
- 設定資料の人物・地名・品物を活用し、各章の出来事が前後の章と因果でつながるようにする。矛盾や唐突な展開を避ける。
- 最終章の最後の場面で、あらすじの結末にふさわしい形で物語を締めくくる。`,
    },
  ];
}

export function scenePrompt(opts: {
  story: Story;
  ci: number;
  si: number;
  target: number;
  previousTail: string;
  existingInScene?: string;
}): ChatMessage[] {
  const { story, ci, si, target, previousTail, existingInScene } = opts;
  const ch = story.chapters[ci];
  const prev = story.chapters
    .slice(0, ci)
    .map((c, i) => `第${i + 1}章「${c.title}」:${c.digest || c.plan}`)
    .join("\n");
  const next = story.chapters[ci + 1];
  const lastScene = ci === story.chapters.length - 1 && si === ch.beats.length - 1;
  const outline = story.chapters.map((c, i) => `第${i + 1}章「${c.title}」:${c.plan}`).join("\n");

  const system = `${EDITOR}設定資料と構成に忠実に、${isShort(story) ? "1話完結の短編小説" : "長編小説"}の本文を一場面ずつ執筆します。

【設定資料】
${bibleToText(story.bible)}

【全体の構成】
${outline}

${STYLE_GUIDE}`;

  const user = `物語「${story.title}」を執筆しています。

${prev ? `【これまでの展開】\n${prev}\n` : ""}
【現在の章】第${ci + 1}章「${ch.title}」
章のあらすじ:${ch.plan}
この章の場面構成:
${ch.beats.map((b, i) => `${i + 1}. ${b}${i === si ? "  ←今回執筆する場面" : ""}`).join("\n")}

${previousTail ? `【直前の本文(この続きから書く)】\n${previousTail}\n` : "【これが物語の冒頭です】\n"}
${existingInScene ? `【この場面でここまでに書いた部分】\n${tail(existingInScene, 1500)}\n\n上の続きを、同じ場面のまま書き足してください。場面を終わらせたり、まとめに入ったりしないでください。\n` : ""}
【今回の指示】
場面${si + 1}「${ch.beats[si]}」を、約${target}字で執筆してください。
- 直前の本文から自然につなげる。同じ内容を繰り返さない。
- この場面の範囲だけを書く。次の場面以降の出来事を先取りしない。
${
  lastScene
    ? "- これが物語の最終場面です。全ての伏線を回収し、余韻のある結末で物語を締めくくる。"
    : `- 物語を勝手に終わらせない。この場面は${next && si === ch.beats.length - 1 ? `次の章(${next.title})` : "次の場面"}へ続く途中経過である。`
}
- 描写・心理・会話を丁寧に書き込み、あっさり要約せず、場面として具体的に描く。
本文のみを出力してください。`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export function digestPrompt(story: Story, ci: number): ChatMessage[] {
  const ch = story.chapters[ci];
  return [
    { role: "system", content: `${EDITOR}小説の章を正確に要約します。出力はJSONのみ。` },
    {
      role: "user",
      content: `次は第${ci + 1}章「${ch.title}」の本文です。後の章を執筆するときの前提資料にするため、この章で起きた出来事、判明した事実、登場人物の状態・関係の変化、未回収の伏線を、300字以内で簡潔に要約してください。

${ch.body}`,
    },
  ];
}

export function bibleUpdatePrompt(story: Story, ci: number): ChatMessage[] {
  const ch = story.chapters[ci];
  const known = [
    ...story.bible.characters.map((c) => c.name),
    ...story.bible.places.map((c) => c.name),
    ...story.bible.items.map((c) => c.name),
    ...story.bible.terms.map((c) => c.name),
  ];
  return [
    { role: "system", content: `${EDITOR}本文と設定資料の整合性を管理する担当者として、本文から設定資料への追記事項を抽出します。出力はJSONのみ。` },
    {
      role: "user",
      content: `【現在の設定資料】
${bibleToText(story.bible)}

【第${ci + 1}章「${ch.title}」本文】
${ch.body}

本文を読み、設定資料に追記すべき事項を抽出してください。
- 本文で新しく登場した人物・地名・品物・用語は、新規項目として全フィールドを埋めて追加する。
- 既存の項目(${known.join("、")})については、本文で新たに判明した事実・状態の変化(負傷、所持品、関係の変化、新たな呼称など)だけを notes に書く。設定資料に既にある内容は書かない。
- 本文に書かれていないことを創作しない。追記がなければ空配列にする。
- 既存項目に追記する場合は name を既存と完全に同じ表記にし、他のフィールドは空文字にする。`,
    },
  ];
}

export function proofreadChunkPrompt(bible: Bible, chunk: string): ChatMessage[] {
  const names = [
    ...bible.characters.map((c) => `${c.name}${c.reading ? `(${c.reading})` : ""}`),
    ...bible.places.map((c) => c.name),
    ...bible.items.map((c) => c.name),
    ...bible.terms.map((c) => c.name),
  ];
  return [
    {
      role: "system",
      content: `あなたは出版社の経験豊富な校閲者です。小説の本文を校閲し、修正後の本文だけを出力します。`,
    },
    {
      role: "user",
      content: `次の本文を校閲してください。

【修正すること】
- 誤字・脱字・変換ミス、助詞の誤用、文法的におかしい表現、主語と述語のねじれ。
- 同一語句の不自然な繰り返し、表記ゆれ、句読点・かぎ括弧の不備。
- 固有名詞が次の表記から外れている場合は正しい表記に直す:${names.join("、")}

【守ること】
- 内容・展開・文体・口調・段落(改行)は変えない。文章を書き足したり削ったりしない。
- 問題がない箇所は一字も変えない。
- 修正後の本文のみを出力する。説明や前置きは不要。

【本文】
${chunk}`,
    },
  ];
}

export function consistencyPrompt(story: Story, ci: number): ChatMessage[] {
  const ch = story.chapters[ci];
  const prev = story.chapters
    .slice(0, ci)
    .map((c, i) => `第${i + 1}章:${c.digest || c.plan}`)
    .join("\n");
  return [
    { role: "system", content: `あなたは小説の校閲者です。本文と設定資料の矛盾を点検します。出力はJSONのみ。` },
    {
      role: "user",
      content: `【設定資料】
${bibleToText(story.bible)}

${prev ? `【これまでの章の要約】\n${prev}\n` : ""}
【点検する本文:第${ci + 1}章「${ch.title}」】
${ch.body}

本文に、次のような問題がないか点検してください。
- 設定資料と食い違う人物の名前・呼称・年齢・外見・口調・能力・所持品・地名。
- 前の章までの展開、同じ章内の出来事との時系列・事実の矛盾(死んだはずの人物が登場する、場所や時間の食い違いなど)。
- 人物の呼び方や一人称の突然のブレ。

見つかった問題だけを issues に列挙してください(最大10件)。
- quote:本文中の該当箇所を、一字一句そのまま、10〜40字程度で抜き出す(本文中に1回しか現れない部分にする)。
- problem:何が問題かを簡潔に。
- replacement:quote を置き換える修正案(quote と同じ範囲を直した文字列)。置き換えで直せない場合は空文字にする。
問題がなければ issues は空配列にしてください。`,
    },
  ];
}
