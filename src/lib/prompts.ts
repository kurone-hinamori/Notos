import type { ChatMessage } from "./ollama";
import type { Bible, BookPlan, SharedContext, SharedEntryContext, Story } from "../types";
import { bibleToText, tail } from "./text";

const EDITOR = "あなたは「小説家になろう」「カクヨム」で人気作を数多く手がけてきた、ライトノベル作家兼編集者です。";

export const STYLE_GUIDE = `【文体・執筆ルール】
- 「小説家になろう」「カクヨム」に載っているような、テンポが良く読みやすいライトノベルの文体で書く。
- 会話文は「」で囲み、会話ごとに改行する。地の文には適度に心理描写・情景描写を入れる。
- 念話・心の声・人ならざる存在の声は『』、配信のコメント・掲示板の書き込み・システムメッセージなどは【】で表してよい。使ってほしいセリフで括弧が指定されている場合は、その括弧を使う。
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

/** ガチャ(企画案)の条件 */
export interface ConceptRequest {
  keywords: string[];
  note: string;
  /** 内容・タイトルが被らないようにする案のタイトル */
  avoidTitles: string[];
  /** 短編集の1話として考える場合 */
  short?: ShortSpec;
  /** 手入力したタイトル(指定するとこのタイトルで案を考える) */
  title?: string;
  /** 短編集から渡される共有情報(共通の登場人物・世界観・使用済みの名前・これまでの話) */
  shared?: SharedContext;
  /** 使ってほしいセリフ */
  lines?: string[];
  /** ジャンル(短編集で全話共通のジャンルを決めている場合) */
  genre?: string;
}

const KIND_LABEL = { places: "場所", items: "品物", terms: "用語" } as const;

/** 使ってほしいセリフをプロンプト用の箇条書きにする */
const linesText = (lines: string[]) =>
  lines
    // 「話者「セリフ」」のように全体が囲んである場合は、外側の括弧を外して 話者「セリフ」 の形で渡す
    .map((l) => `- ${l.replace(/^[「『【](.*[「『【].*[」』】])[」』】]$/, "$1")}`)
    .join("\n");

/** 共通の登場人物をプロンプト用のテキストにする */
export function sharedCharactersText(chars: SharedContext["characters"]): string {
  return chars
    .map((c) => {
      const lines = [
        `■${c.name}${c.reading ? `(${c.reading})` : ""}`,
        c.role && `役割:${c.role}`,
        c.age && `年齢:${c.age}`,
        c.appearance && `外見:${c.appearance}`,
        c.personality && `性格:${c.personality}`,
        c.speech && `口調:${c.speech}`,
        c.background && `経歴:${c.background}`,
        c.relations && `関係:${c.relations}`,
        c.history && `これまでの経緯:${c.history}`,
      ];
      return lines.filter(Boolean).join("\n");
    })
    .join("\n");
}

/** この話の途中で手に入れる共通の品物 */
export function acquiringEntries(shared: SharedContext | undefined): SharedEntryContext[] {
  return (shared?.entries ?? []).filter((e) => e.status === "acquire");
}

/**
 * 場面ごとの「まだ手に入れていないもの/この場面で手に入れるもの」の指示。
 * あらすじに書くだけでは入手前に使ってしまうことがあるので、場面単位で明示する。
 */
function acquisitionNotes(story: Story, ci: number, si: number): string {
  const names = acquiringEntries(story.shared).map((e) => e.name);
  if (!names.length) return "";
  const notYet: string[] = [];
  const now: string[] = [];
  for (const name of names) {
    const at = story.chapters.flatMap((c, i) => (c.acquire ?? []).filter((x) => x.name === name).map((x) => ({ ci: i, si: x.scene })))[0];
    if (!at) continue;
    if (ci < at.ci || (ci === at.ci && si < at.si)) notYet.push(name);
    else if (ci === at.ci && si === at.si) now.push(name);
  }
  const parts: string[] = [];
  if (notYet.length) {
    parts.push(
      `【まだ手に入れていないもの】${notYet.join("、")}\n- この場面の時点では、登場人物はまだこれを持っていない。持っている・使う・身に着けている描写をしないこと。\n- 目的や噂、伝説として話題にするのはよい。`,
    );
  }
  if (now.length) {
    parts.push(
      `【この場面で手に入れるもの】${now.join("、")}\n- この場面で初めて手に入れる。場面の始まりではまだ持っておらず、この場面の出来事の結果として手に入れること。\n- 手に入れる瞬間を、省略せずに具体的に描くこと。\n- この場面の終わりには、登場人物がそれ自体を実際に手にしていること。手に入らない・別のものにすり替わる・失う、という結果にはしないこと。`,
    );
  }
  return parts.length ? `\n${parts.join("\n")}\n` : "";
}

/** 「」以外の括弧で話す人物の決まり(例:竜のセリフは『』) */
export function bracketRuleList(story: Story): { name: string; bracket: string }[] {
  return story.bible.characters.filter((c) => c.bracket && c.bracket !== "「」").map((c) => ({ name: c.name, bracket: c.bracket! }));
}

function bracketRules(story: Story): string {
  const rules = bracketRuleList(story);
  if (!rules.length) return "";
  return `\n【セリフの括弧の決まり】\n${rules.map((r) => `- ${r.name}のセリフは必ず${r.bracket}で書く(「」にしない)`).join("\n")}\n`;
}

/** 短編集の共有情報をプロンプトに差し込む指示にする */
function sharedInstructions(shared: SharedContext | undefined, target: "concept" | "bible"): string {
  if (!shared) return "";
  const parts: string[] = [];
  if (shared.world.trim()) parts.push(`【短編集の共通の世界観】\n${shared.world.trim()}\nこの世界観・舞台設定に従うこと。`);
  if (shared.previous.trim()) parts.push(`【これまでの話(連作短編)】\n${shared.previous.trim()}\nこれまでの話の後の出来事として、矛盾しないようにすること。ただし、あらすじや本文に「第1話」などの話数や、作品の外側の言葉を書かないこと。`);
  if (shared.characters.length) {
    parts.push(
      `【この話に登場する共通の登場人物(確定設定)】\n${sharedCharactersText(shared.characters)}\n` +
        (target === "concept"
          ? "これらの人物は、他の話にも登場する同一人物です。必ず登場させ、characters にも同じ name で含める。名前・性格・口調・関係・経緯を変えないこと。"
          : "これらの人物は確定済みの設定で、自動的に設定資料に追加されます。characters には含めないこと。他の人物との関係や経歴は、この設定と矛盾しないようにすること。"),
    );
  }
  const entryLine = (e: SharedEntryContext) =>
    `■${e.name}(${KIND_LABEL[e.kind]}):${e.description}${e.condition ? `(条件:${e.condition})` : ""}${e.history ? `(これまでの経緯:${e.history})` : ""}`;
  const owned = (shared.entries ?? []).filter((e) => e.status !== "acquire");
  const acquiring = acquiringEntries(shared);
  if (owned.length) {
    parts.push(
      `【短編集の共通の設定(場所・品物・用語)】\n${owned.map(entryLine).join("\n")}\n` +
        (target === "concept"
          ? "これらは他の話と共通の設定です。物語に必要なものだけを登場させる。登場させる場合は、名称・設定・経緯を変えないこと。同じ役割の別のものを新しく作らないこと。"
          : "これらは確定済みの設定で、自動的に設定資料に追加されます。places・items・terms には含めないこと。同じ役割の別のものを新しく作らないこと。"),
    );
  }
  if (acquiring.length) {
    parts.push(
      `【この話で初めて手に入れるもの】\n${acquiring.map(entryLine).join("\n")}\n` +
        `この話が始まる時点では、登場人物はまだこれを持っていない。この話の中で手に入れる${
          acquiring.some((e) => e.acquireAt === "last") ? "(「最後に手に入れる」と指定されたものは、物語の最後の場面で手に入れる)" : ""
        }。手に入れる前に、持っていたり使ったりしないこと(目的・噂・伝説として語るのはよい)。名称・設定は変えないこと。` +
        "この話の結末までに、登場人物がそれ自体を必ず実際に手に入れること。次の話からは持っているものとして扱うので、「手に入らなかった」「偽物だった」「別のものが本物だった」「手に入れたが失った」といった展開にはしないこと。" +
        (target === "bible" ? "これらも自動的に設定資料に追加されるので、items には含めないこと。" : ""),
    );
  }
  if (shared.avoidNames.length) {
    parts.push(`【使用済みの名前】${shared.avoidNames.join("、")}\nこれらは他の話の別人の名前なので、新しい人物には使わないこと。`);
  }
  return parts.join("\n\n");
}

export function conceptPrompt(req: ConceptRequest): ChatMessage[] {
  const { keywords, note, avoidTitles, short, title } = req;
  const serial = req.shared?.serial;
  const form = serial
    ? `Web連載のライトノベルの第${serial.index + 1}話(全${serial.total}話。約${short?.chars.toLocaleString()}字を${serial.scenes}回に分けて投稿する)`
    : short
      ? `1話で完結する短編ライトノベル(約${short.chars.toLocaleString()}字)`
      : "長編ライトノベル(文庫本1冊分)";
  const shared = sharedInstructions(req.shared, "concept");
  return [
    {
      role: "system",
      content: `${EDITOR}与えられたキーワードから、${form}の企画案を1つ考えます。出力はJSONのみ。`,
    },
    {
      role: "user",
      content: `次のキーワードをもとに、物語の概要を考えてください。

キーワード:${keywords.join("、") || "(なし)"}
${note.trim() ? `補足の希望:${note.trim()}\n` : ""}${title?.trim() ? `タイトル:「${title.trim()}」(このタイトルは確定。変更しないこと)\n` : ""}
${shared ? `${shared}\n` : ""}${
        req.lines?.length
          ? `\n【使ってほしいセリフ】\n${linesText(req.lines)}\nこれらのセリフは本文で必ずそのまま、上から順番に使います。上のセリフから順に、それぞれが自然に口にされる場面が生まれるような人物と展開にすること。\n`
          : ""
      }
【条件】
- すべてのキーワードを物語の核として自然に取り入れる。
- 王道に収まらない、意外性のある切り口・設定にする(企画ID:${rand()})。
${
  title?.trim()
    ? `- title:必ず「${title.trim()}」とする。タイトルにふさわしい内容を考える。`
    : "- title:Web小説らしくキャッチーで、内容が伝わるタイトル(40字以内)。"
}
- tagline:読者の興味を引く一行キャッチコピー(40字以内)。
${
  req.genre?.trim()
    ? `- genre:必ず「${req.genre.trim()}」とする。このジャンルの物語として考える。`
    : "- genre:ジャンル(例:異世界ファンタジー、現代ラブコメ、ミステリー)。"
}
${
  serial
    ? `- これは連載の第${serial.index + 1}話です(全${serial.total}話)。約${short?.chars.toLocaleString()}字で、この話の中に1つの山場を作る。
- ${serial.index + 1 === serial.total ? "これは最終話です。これまでの伏線を回収し、物語全体を完結させる。" : serial.index === 0 ? "これは第1話です。主人公と世界の魅力、物語全体の目的や謎を提示し、続きが読みたくなる引きで終える。物語全体はまだ終わらせない。" : "前の話の続きとして始め、この話の出来事に区切りをつけつつ、次の話への引きを残して終える。物語全体はまだ終わらせない。"}
- synopsis:この話のあらすじ。250〜400字。話の終わり方まで含める。あらすじ中の`
    : short
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
      content: `次の企画から、設定資料を作成してください。${
        s.shared?.serial
          ? `これは連載小説の第${s.shared.serial.index + 1}話(約${storyLength(s).toLocaleString()}字)です。この話に必要な分だけを簡潔に、しかし具体的に書いてください。`
          : short
            ? `これは約${storyLength(s).toLocaleString()}字の1話完結の短編です。短編に必要な分だけを簡潔に、しかし具体的に書いてください。`
            : ""
      }

${conceptText(s)}
${s.shared ? `\n${sharedInstructions(s.shared, "bible")}\n` : ""}
【条件】
- premise:物語の前提・核となる謎や対立・結末の方向性を200〜300字で。
- worldview:世界観・舞台・時代・社会のルール(魔法や技術があればそのルール)を${short ? "150〜300字" : "300〜500字"}で。
- style:文体指針。視点(例:主人公の一人称/三人称一元視点)、時制、全体のトーン、会話と地の文の比率などを具体的に。
- timeline:物語の舞台設定上の時系列(物語開始時点までの重要な過去の出来事と、物語内の期間)。
- characters:企画の登場人物すべて(必要なら脇役も追加して${short ? "3〜6名" : "6〜10名"})。各人物について reading(読み仮名)、age、appearance(外見)、personality(性格)、speech(口調・一人称・二人称の呼び方の例)、background(経歴)、relations(他の人物との関係)を具体的に。bracket はセリフの括弧で、ふつうに声に出して話す人物は「」。念話・テレパシー・人ならざる存在の声など特別な話し方をする人物だけ『』、機械音声やシステムなどは【】にする。
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
          ? s.shared?.serial
            ? `これは連載小説の第${s.shared.serial.index + 1}話(全${s.shared.serial.total}話。約${storyLength(s).toLocaleString()}字)で、章は1つだけです。各場面はそれぞれ連載の1回分(約${s.plan.charsPerScene.toLocaleString()}字)として投稿するので、場面ごとに見せ場を作り、場面の終わりは次の回が読みたくなる引きにしてください。${
                s.shared.serial.index + 1 === s.shared.serial.total
                  ? "これは最終話なので、最後の場面で物語全体を完結させてください。"
                  : "最後の場面はこの話の区切りとし、次の話への引きを残してください(物語全体はまだ終わらせない)。"
              }`
            : `これは約${storyLength(s).toLocaleString()}字の1話完結の短編なので、章は1つだけです。beats で導入・展開・山場・結末を組み立て、最後の場面で物語を完結させてください。`
          : ""
      }

【条件】
- 全${plan.chapters}章。chapters 配列の要素数を必ず${plan.chapters}にする。
- 各章は title(章題)、plan(その章のあらすじ。150〜250字)、beats(場面ごとの展開。要素数は必ず${plan.scenes}。各60〜120字で、具体的な出来事・会話の要点・感情の動きを書く)。
- 起承転結を意識し、前半で世界と人物を魅力的に提示し、中盤で状況を転換させ、終盤で伏線を回収して、最終章で物語を完結させる。
- 設定資料の人物・地名・品物を活用し、各章の出来事が前後の章と因果でつながるようにする。矛盾や唐突な展開を避ける。
- 最終章の最後の場面で、あらすじの結末にふさわしい形で物語を締めくくる。${
        s.lines?.length
          ? `

【使ってほしいセリフ】
${linesText(s.lines)}
- これらのセリフは本文で必ず一字一句そのまま、上から順番に使う。上のセリフほど前の場面、下のセリフほど後の場面になるようにし、順番を入れ替えないこと(同じ場面で続けて使う場合も、上から順に)。
- それぞれのセリフが自然に、効果的に口にされる場面を決め、その場面の beats に、誰がどんな状況でそのセリフを言うのかを書き込むこと。
- lineScenes に、すべてのセリフについて、line(上のセリフをそのまま)、chapter(章の番号。1始まり)、scene(その章の中の場面の番号。1始まり)を入れること。`
          : "\n- lineScenes は空配列にする。"
      }${
        acquiringEntries(s.shared).length
          ? `

【この話で初めて手に入れるもの】
${acquiringEntries(s.shared)
  .map((e) => `- ${e.name}${e.acquireAt === "last" ? "(必ず最後の場面で手に入れる)" : ""}${e.condition ? `(条件:${e.condition})` : ""}`)
  .join("\n")}
- 物語の始まりでは、登場人物はまだこれを持っていない。どの場面で手に入れるかを決め、その場面の beats に、どうやって手に入れるのかを書き込むこと。
- その場面で、登場人物がそれ自体を必ず実際に手に入れること(次の話からは持っているものとして扱う)。「手に入らなかった」「偽物だった」「別のものが本物だった」「手に入れたが失った」という展開にはしないこと。
- それより前の場面の beats では、持っている・使う展開にしないこと(探す、目指す、話題にするのはよい)。
- acquireScenes に、上のそれぞれについて、name(上の名称をそのまま)、chapter(章の番号。1始まり)、scene(その章の中の場面の番号。1始まり)を入れること。`
          : "\n- acquireScenes は空配列にする。"
      }`,
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
  /** この場面で必ず使うセリフ(まだ本文に入っていないもの) */
  lines?: string[];
  /** 後の場面で使うので、この場面ではまだ使わないセリフ */
  later?: string[];
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

  const serial = story.shared?.serial;
  const system = `${EDITOR}設定資料と構成に忠実に、${serial ? "Web連載小説" : isShort(story) ? "1話完結の短編小説" : "長編小説"}の本文を一場面ずつ執筆します。

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

${
  previousTail
    ? `【直前の本文(この続きから書く)】\n${previousTail}\n`
    : serial && serial.index > 0
      ? `【前の話までのあらすじ】\n${story.shared?.previous || "(なし)"}\n${serial.prevTail ? `\n【前の話の最後の本文】\n${serial.prevTail}\n` : ""}\nこれは連載の第${serial.index + 1}話の書き出しです。前の話の続きとして、自然につなげて書き始めてください。\n`
      : "【これが物語の冒頭です】\n"
}
${existingInScene ? `【この場面でここまでに書いた部分】\n${tail(existingInScene, 1500)}\n\n上の続きを、同じ場面のまま書き足してください。場面を終わらせたり、まとめに入ったりしないでください。\n` : ""}
【今回の指示】
場面${si + 1}「${ch.beats[si]}」を、約${target}字で執筆してください。
- 直前の本文から自然につなげる。同じ内容を繰り返さない。
- この場面の範囲だけを書く。次の場面以降の出来事を先取りしない。
${
  serial
    ? `- この場面は、連載の1回分として単独で投稿される。読者を引きつける見せ場を入れ、${
        lastScene
          ? serial.index + 1 === serial.total
            ? "これが連載の最終回です。全ての伏線を回収し、余韻のある結末で物語全体を締めくくる。"
            : "これはこの話の最後の回です。この話の出来事に区切りをつけ、次の話が気になる引きで終える。物語全体はまだ終わらせない。"
          : "最後は次の回が読みたくなる引きで終える。物語を勝手に終わらせない。"
      }`
    : lastScene
      ? "- これが物語の最終場面です。全ての伏線を回収し、余韻のある結末で物語を締めくくる。"
      : `- 物語を勝手に終わらせない。この場面は${next && si === ch.beats.length - 1 ? `次の章(${next.title})` : "次の場面"}へ続く途中経過である。`
}
- 描写・心理・会話を丁寧に書き込み、あっさり要約せず、場面として具体的に描く。
${acquisitionNotes(story, ci, si)}${bracketRules(story)}${
  opts.lines?.length
    ? `
【この場面で必ず使うセリフ】
${linesText(opts.lines)}
- 上のセリフを、この場面の会話として必ず使うこと。括弧の中の言葉は一字一句変えない(言い換え・省略・語尾の変更をしない)。
- 括弧の種類(「」『』【】)も指定どおりにする。『』や【】で指定されたものを「」に変えない。
- 複数ある場合は、上から順番に登場させること。
- 話者が書かれている場合はその人物に言わせる。セリフが自然に出てくるように、直前の会話や状況を組み立てること。
`
    : ""
}${
  opts.later?.length
    ? `
【この場面ではまだ使わないセリフ】
${linesText(opts.later)}
- これらは後の場面で使うので、この場面では誰にも言わせないこと(同じ意味の言い回しも避ける)。
`
    : ""
}本文のみを出力してください。`;

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

export function proofreadChunkPrompt(bible: Bible, chunk: string, keepLines: string[] = []): ChatMessage[] {
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
- 問題がない箇所は一字も変えない。${
        keepLines.length ? `\n- 次のセリフは作者が指定したものなので、一字も変えない:${keepLines.join("")}(括弧の種類も変えない)` : ""
      }
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
- 人物の呼び方や一人称の突然のブレ。${ch.acquire?.length ? `\n${ch.acquire
        .map(
          (x) =>
            `- 「${x.name}」は、この章の${x.scene + 1}番目の場面(場面は空行で区切られている)で初めて手に入れる。それより前に、登場人物が「${x.name}」を持っている・使っている描写がないか(話題にするだけならよい)。また、その場面で実際に「${x.name}」そのものを手に入れているか(手に入れていない、別のものにすり替わっている場合は問題として挙げる)。`,
        )
        .join("\n")}` : ""}

見つかった問題だけを issues に列挙してください(最大10件)。
- quote:本文中の該当箇所を、一字一句そのまま、10〜40字程度で抜き出す(本文中に1回しか現れない部分にする)。
- problem:何が問題かを簡潔に。
- replacement:quote を置き換える修正案(quote と同じ範囲を直した文字列)。置き換えで直せない場合は空文字にする。
問題がなければ issues は空配列にしてください。`,
    },
  ];
}

/** 短編集の共通の登場人物(と世界観)を考える */
export function castPrompt(opts: {
  title: string;
  keywords: string[];
  note: string;
  world: string;
  existing: string[];
  count: number;
}): ChatMessage[] {
  return [
    {
      role: "system",
      content: `${EDITOR}連作短編集で、複数の話にまたがって登場するレギュラーの登場人物を考えます。出力はJSONのみ。`,
    },
    {
      role: "user",
      content: `次の短編集に登場するレギュラーの登場人物を${opts.count}名考えてください。

短編集のタイトル:${opts.title || "(未定)"}
キーワード:${opts.keywords.join("、") || "(なし)"}
${opts.note.trim() ? `補足の希望:${opts.note.trim()}\n` : ""}${opts.world.trim() ? `世界観:${opts.world.trim()}\n` : ""}${opts.existing.length ? `既にいるレギュラー:${opts.existing.join("、")}(この人物たちと関係を持たせ、名前を重複させない)\n` : ""}
【条件】
- どの話にも登場させやすく、話ごとに違う一面を見せられる魅力的な人物にする(企画ID:${rand()})。
- 各人物について name(日本語表記の氏名)、reading(読み仮名)、role(短編集での役割)、age、appearance(外見)、personality(性格)、speech(口調・一人称・二人称の呼び方の例)、background(経歴)、relations(他のレギュラーとの関係)を具体的に。bracket はセリフの括弧で、ふつうに声に出して話す人物は「」。念話・テレパシー・人ならざる存在の声など特別な話し方をする人物だけ『』、機械音声やシステムなどは【】にする。
- world:${opts.world.trim() ? "与えられた世界観をそのまま返す。" : "短編集全体の舞台・世界観を150〜300字で考える。"}`,
    },
  ];
}

/** 1話の本文から、共通の設定(登場人物・場所・品物・用語)に起きた変化を抜き出す */
export function castChangesPrompt(story: Story, names: string[]): ChatMessage[] {
  const body = story.chapters.map((c) => c.body).join("\n\n");
  // この話の設定資料に追記された内容(本文で判明した事実)も手がかりとして渡す
  const b = story.bible;
  const notes = [...b.characters, ...b.places, ...b.items, ...b.terms]
    .filter((x) => names.includes(x.name) && x.notes?.trim())
    .map((x) => `- ${x.name}:${x.notes.trim()}`)
    .join("\n");
  return [
    { role: "system", content: `${EDITOR}連作短編集の設定管理担当として、話をまたいで引き継ぐ情報を整理します。出力はJSONのみ。` },
    {
      role: "user",
      content: `次は短編「${story.title}」の本文です。短編集の共通の設定(${names.join("、")})のそれぞれについて、この話で起きた出来事・状態や関係の変化・持ち主や場所の変化・新たに判明した事実を、後の話へ引き継ぐ情報として、1件につき1〜3文(120字以内)でまとめてください。
- 本文に書かれていないことは書かない。
- この話に登場しなかったものや、引き継ぐべき変化がないものは含めない。
- 後の話を書く人が知らないと矛盾が起きる事実(壊れた、失った、手に入れた、正体が分かった、関係が変わった など)を優先する。
- name は上の表記と完全に同じにする。
${notes ? `\n【この話の設定資料に追記された内容(参考)】\n${notes}\n` : ""}
【本文】
${body}`,
    },
  ];
}

/** 短編集の共通の設定(場所・品物・用語)を考える */
export function entriesPrompt(opts: {
  kind: "places" | "items" | "terms";
  title: string;
  keywords: string[];
  note: string;
  world: string;
  cast: string[];
  existing: string[];
  count: number;
}): ChatMessage[] {
  const what = {
    places: "何度も舞台になる場所",
    items: "物語の鍵になる重要な品物・道具",
    terms: "固有の用語・組織・決まりごと",
  }[opts.kind];
  return [
    { role: "system", content: `${EDITOR}連作短編集で、複数の話にまたがって登場する共通の設定を考えます。出力はJSONのみ。` },
    {
      role: "user",
      content: `次の短編集で使う、${what}を${opts.count}件考えてください。

短編集のタイトル:${opts.title || "(未定)"}
キーワード:${opts.keywords.join("、") || "(なし)"}
${opts.note.trim() ? `補足の希望:${opts.note.trim()}\n` : ""}${opts.world.trim() ? `世界観:${opts.world.trim()}\n` : ""}${opts.cast.length ? `レギュラーの登場人物:${opts.cast.join("、")}\n` : ""}${opts.existing.length ? `既にある設定:${opts.existing.join("、")}(重複させない)\n` : ""}
【条件】
- どの話でも同じものとして登場させられるよう、名称と設定をはっきり決める(企画ID:${rand()})。
- name は名称、description は外見・特徴・由来・できること/できないことなどを80〜160字で具体的に。`,
    },
  ];
}

/** 書いた場面に、指定のセリフを組み込んで書き直す */
export function insertLinePrompt(
  story: Story,
  scene: string,
  lines: string[],
  order: string[] = [],
  early: string[] = [],
): ChatMessage[] {
  return [
    {
      role: "system",
      content: `${EDITOR}小説の一場面を、指定されたセリフを含むように手直しします。\n\n【設定資料】\n${bibleToText(story.bible)}\n\n${STYLE_GUIDE}`,
    },
    {
      role: "user",
      content: `次の場面の本文は、作者が指定したセリフの決まりを守れていません。場面の流れ・長さ・文体をできるだけ保ったまま、下の決まりを守るように会話を足すか直して、場面全体を書き直してください。
${lines.length ? `\n【必ず入れるセリフ】\n${linesText(lines)}\n` : ""}${
        early.length
          ? `\n【この場面から取り除くセリフ】\n${linesText(early)}\n- これらは後の場面で使うセリフなので、この場面では言わせない。別の言葉に置き換えるか、その会話を削る。\n`
          : ""
      }
- 括弧の中の言葉は一字一句変えない(言い換え・省略・語尾の変更をしない)。括弧の種類(「」『』【】)も指定どおりにする。
- 話者が書かれている場合はその人物に言わせる。${
        order.length > 1 ? `\n- この場面のセリフは、次の順番で登場させる:\n${linesText(order)}` : ""
      }
- それ以外の部分はなるべく変えない。場面を短くしない。

【場面の本文】
${scene}

書き直した場面の本文のみを出力してください。`,
    },
  ];
}

/** カクヨム連載:場面(=連載1回分)ごとのサブタイトルを考える */
export function subtitlesPrompt(story: Story): ChatMessage[] {
  const ch = story.chapters[0];
  const n = story.shared?.serial ? `第${story.shared.serial.index + 1}話` : "この話";
  return [
    { role: "system", content: `${EDITOR}Web連載小説の各回のサブタイトルを考えます。出力はJSONのみ。` },
    {
      role: "user",
      content: `連載小説の${n}「${story.title}」は、次の${ch.beats.length}回に分けて投稿します。各回のサブタイトルを考えてください。

【この話のあらすじ】
${story.synopsis}

【各回の内容】
${ch.beats.map((b, i) => `${i + 1}回目:${b}`).join("\n")}

【条件】
- titles に、${ch.beats.length}個のサブタイトルを順番に入れる(要素数は必ず${ch.beats.length})。
- 各回の内容が伝わり、読みたくなる、Web小説らしいサブタイトルにする。1つ20字以内。
- 結末やどんでん返しをそのまま書いてネタバレしない。
- 「第1回」などの番号や、かぎ括弧は付けない。`,
    },
  ];
}

/** カクヨム連載:キャッチコピー・紹介文・タグを考える */
export function kakuyomuPrompt(opts: {
  title: string;
  genre: string;
  world: string;
  keywords: string[];
  cast: string[];
  episodes: { title: string; synopsis: string }[];
  catchcopyMax: number;
  tagsMax: number;
  /** 別に必ず付けるタグ(生成するタグには含めない) */
  fixedTags?: string[];
}): ChatMessage[] {
  return [
    {
      role: "system",
      content: `${EDITOR}小説投稿サイト「カクヨム」に連載する作品の、キャッチコピー・紹介文・タグを考えます。出力はJSONのみ。`,
    },
    {
      role: "user",
      content: `次の連載作品の、カクヨム掲載用の情報を考えてください。

作品名:${opts.title || "(未定)"}
ジャンル:${opts.genre || "(未定)"}
キーワード:${opts.keywords.join("、") || "(なし)"}
${opts.world.trim() ? `世界観:${opts.world.trim()}\n` : ""}${opts.cast.length ? `主な登場人物:${opts.cast.join("、")}\n` : ""}
【各話の内容】
${opts.episodes.length ? opts.episodes.map((e, i) => `第${i + 1}話「${e.title}」:${e.synopsis}`).join("\n") : "(まだ決まっていません。上の情報から考えてください)"}

【条件】
- catchcopy:作品の魅力が一目で伝わるキャッチコピー。必ず${opts.catchcopyMax}字以内(空白・記号も1字と数える)。
- introduction:作品の紹介文。300〜600字。主人公と状況、物語の目的や謎、読みどころを伝え、続きを読みたくなるようにする。結末は書かない。段落は改行で区切る。
- tags:作品のタグ。${opts.tagsMax}個以内。ジャンル・題材・雰囲気・主人公の属性など、読者が検索しそうな短い言葉にする。1つのタグに空白や「#」を含めない。${
        opts.fixedTags?.length ? `「${opts.fixedTags.join("」「")}」は別に必ず付けるので、tags には含めない。` : ""
      }`,
    },
  ];
}

/** 決まった括弧で話す人物のセリフが、違う括弧で書かれていないかを点検する */
export function bracketCheckPrompt(story: Story, ci: number): ChatMessage[] {
  const ch = story.chapters[ci];
  const rules = bracketRuleList(story);
  return [
    { role: "system", content: `あなたは小説の校閲者です。セリフの括弧の使い分けを点検します。出力はJSONのみ。` },
    {
      role: "user",
      content: `この小説では、次の人物のセリフは決まった括弧で書きます。
${rules.map((r) => `- ${r.name}:${r.bracket}`).join("\n")}

【本文】
${ch.body}

本文の中から、上の人物のセリフなのに、決まりと違う括弧(たとえば『』で書くべきなのに「」)で書かれているものを、すべて挙げてください。
- 誰のセリフかは、前後の地の文(「〜と竜は言った」など)や会話の流れから判断する。確信が持てないものは挙げない。
- 上の人物以外のセリフは挙げない。決まりどおりの括弧で書かれているものも挙げない。
- speaker:話している人物の名前(上の表記どおり)。
- text:括弧の中の文字列を、本文から一字一句そのまま抜き出す(括弧そのものは含めない)。
該当がなければ lines は空配列にしてください。`,
    },
  ];
}
