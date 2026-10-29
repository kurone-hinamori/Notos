import { useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { Anthology, KakuyomuInfo, Settings } from "../types";
import { KAKUYOMU_CATCHCOPY_MAX, KAKUYOMU_FIXED_TAGS, KAKUYOMU_POST_MAX, KAKUYOMU_POST_MIN, KAKUYOMU_TAGS_MAX, withFixedTags } from "../types";
import type { Task } from "../lib/pipeline";
import { generateKakuyomuInfo } from "../lib/pipeline";
import { isUndecided } from "../lib/storage";
import { postsOf } from "../lib/anthology";
import { countChars } from "../lib/text";
import { Section } from "./ui";

type MutateAnthology = (m: (draft: Anthology) => void) => void;

const len = (s: string) => [...s].length;

/** クリップボードにコピーする(使えない環境では、選択してコピーする方法に切り替える) */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function CopyButton({ text, label = "コピー" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="small"
      disabled={!text}
      onClick={() =>
        void copy(text).then((ok) => {
          if (!ok) return;
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? "✔ コピーしました" : label}
    </button>
  );
}

/** カクヨムの掲載情報(キャッチコピー・紹介文・タグ)の編集と自動作成 */
export function KakuyomuInfoEditor(props: { anthology: Anthology; mutate: MutateAnthology; settings: Settings }) {
  const { anthology: a, mutate } = props;
  const stored: KakuyomuInfo = a.kakuyomu ?? { catchcopy: "", introduction: "", tags: [] };
  // 「AI本文利用」は常に先頭に付ける(以前に作った連載にも)
  const info: KakuyomuInfo = { ...stored, tags: withFixedTags(stored.tags) };
  const free = (tags: string[]) => tags.filter((t) => !KAKUYOMU_FIXED_TAGS.includes(t));
  const [tagText, setTagText] = useState(free(info.tags).join("、"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);

  const setInfo = (patch: Partial<KakuyomuInfo>) =>
    mutate((d) => void (d.kakuyomu = { ...(d.kakuyomu ?? { catchcopy: "", introduction: "", tags: [] }), ...patch }));

  const generate = async () => {
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    try {
      const r = await generateKakuyomuInfo(
        props.settings,
        {
          title: a.title,
          genre: a.genre ?? "",
          world: a.world ?? "",
          keywords: a.keywords,
          cast: (a.cast ?? []).map((c) => `${c.name}(${c.role})`),
          episodes: a.episodes.filter((e) => !isUndecided(e)).map((e) => ({ title: e.title, synopsis: e.synopsis })),
        },
        abort.current.signal,
      );
      setInfo(r);
      setTagText(free(r.tags).join("、"));
    } catch (e) {
      if (!abort.current?.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const ccOver = len(info.catchcopy) > KAKUYOMU_CATCHCOPY_MAX;
  const tagsOver = info.tags.length > KAKUYOMU_TAGS_MAX;

  return (
    <div className="stack">
      <div className="row wrap">
        <button className="primary" disabled={busy} onClick={() => void generate()}>
          {busy ? "考え中…" : "🎲 キャッチコピー・紹介文・タグを自動で作る"}
        </button>
        {busy && <button onClick={() => abort.current?.abort()}>中止</button>}
        <span className="muted small-text">連載の名前・ジャンル・世界観・共通の登場人物と、概要が決まっている話のあらすじから考えます。</span>
      </div>
      {error && <p className="error">{error}</p>}

      <label className="field">
        <span>
          キャッチコピー
          <span className={ccOver ? "error" : "muted"}>
            ({len(info.catchcopy)}/{KAKUYOMU_CATCHCOPY_MAX}字{ccOver ? "・上限を超えています" : ""})
          </span>
        </span>
        <div className="row">
          <input className="grow" value={info.catchcopy} onChange={(e) => setInfo({ catchcopy: e.target.value })} />
          <CopyButton text={info.catchcopy} />
        </div>
      </label>

      <label className="field">
        <span>
          紹介文 <span className="muted">({countChars(info.introduction).toLocaleString()}字)</span>
        </span>
        <textarea rows={8} value={info.introduction} onChange={(e) => setInfo({ introduction: e.target.value })} />
        <div className="row">
          <CopyButton text={info.introduction} />
        </div>
      </label>

      <label className="field">
        <span>
          タグ(「{KAKUYOMU_FIXED_TAGS.join("」「")}」は固定。残りを読点区切りで入力)
          <span className={tagsOver ? "error" : "muted"}>
            ({info.tags.length}/{KAKUYOMU_TAGS_MAX}個{tagsOver ? "・上限を超えています" : ""})
          </span>
        </span>
        <input
          value={tagText}
          placeholder="例:異世界ファンタジー、成り上がり、ハッピーエンド"
          onChange={(e) => {
            setTagText(e.target.value);
            setInfo({ tags: withFixedTags([...new Set(e.target.value.split(/[,、，\s#＃]+/).map((t) => t.trim()).filter(Boolean))]) });
          }}
        />
        {info.tags.length > 0 && (
          <div className="row wrap">
            {info.tags.map((t, i) => (
              <span
                key={t}
                className={KAKUYOMU_FIXED_TAGS.includes(t) ? "tag tag-strong" : i < KAKUYOMU_TAGS_MAX ? "tag" : "tag tag-off"}
                title={KAKUYOMU_FIXED_TAGS.includes(t) ? "必須のタグなので固定です" : undefined}
              >
                {KAKUYOMU_FIXED_TAGS.includes(t) ? `🔒 ${t}` : t}
              </span>
            ))}
            <CopyButton text={info.tags.join(" ")} label="スペース区切りでコピー" />
          </div>
        )}
      </label>
    </div>
  );
}

/** カクヨム投稿:話(=章)ごとに、連載1回分ずつのサブタイトルと本文を並べる */
export function KakuyomuPosts(props: {
  anthology: Anthology;
  mutate: MutateAnthology;
  start: (t: Task, episode: number) => void;
  running: boolean;
  settings: Settings;
}) {
  const { anthology: a, mutate } = props;
  const [message, setMessage] = useState("");
  const written = a.episodes.map((e, i) => ({ e, i, posts: postsOf(e) })).filter((x) => x.posts.length);
  const total = written.reduce((n, x) => n + x.posts.length, 0);

  /** 投稿用のテキストを1つのファイルにまとめて保存する */
  const saveAll = async () => {
    setMessage("");
    const lines: string[] = [];
    const k = a.kakuyomu;
    lines.push(`■作品名\n${a.title}`);
    if (k?.catchcopy) lines.push(`■キャッチコピー\n${k.catchcopy}`);
    if (k?.introduction) lines.push(`■紹介文\n${k.introduction}`);
    lines.push(`■タグ\n${withFixedTags(k?.tags ?? []).join(" ")}`);
    for (const { e, i, posts } of written) {
      lines.push(`\n========================================\n■章:第${i + 1}話 ${e.title}`);
      posts.forEach((p, j) => lines.push(`\n----------------------------------------\n■エピソード:${p.title || `${j + 1}`}\n\n${p.body}`));
    }
    try {
      const safe = a.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "kakuyomu";
      const path = await save({ defaultPath: `${safe}_カクヨム投稿用.txt`, filters: [{ name: "テキスト", extensions: ["txt"] }] });
      if (!path) return;
      await writeFile(path, new TextEncoder().encode(lines.join("\n\n")));
      setMessage(`保存しました:${path}`);
    } catch (e) {
      setMessage(`保存に失敗しました:${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="stack">
      <Section title="カクヨムの掲載情報(キャッチコピー・紹介文・タグ)">
        <KakuyomuInfoEditor anthology={a} mutate={mutate} settings={props.settings} />
      </Section>

      <Section
        title="カクヨム投稿用"
        actions={
          <button disabled={!total} onClick={() => void saveAll()}>
            全話をテキストで保存
          </button>
        }
      >
        <p className="muted small-text">
          カクヨムでは、話のタイトルを「章」、各回のサブタイトルを「エピソード」として登録します。1回分の目安は
          {KAKUYOMU_POST_MIN.toLocaleString()}〜{KAKUYOMU_POST_MAX.toLocaleString()}字です。作品名は「連載の情報」タブで変更できます。
        </p>
        {message && <p className={message.startsWith("保存に失敗") ? "error" : "muted"}>{message}</p>}
        {!total && <p className="muted">まだ本文のある話がありません。</p>}
      </Section>

      {written.map(({ e, i, posts }) => (
        <Section
          key={e.id}
          title={`章:第${i + 1}話 ${e.title}`}
          actions={
            <>
              <CopyButton text={`第${i + 1}話 ${e.title}`} label="章の名前をコピー" />
              <button
                className="small"
                disabled={props.running || !e.chapters[0]?.beats.length}
                title="各回の内容から、サブタイトルを作り直します"
                onClick={() => props.start({ kind: "subtitles" }, i)}
              >
                サブタイトルを作り直す
              </button>
            </>
          }
        >
          {posts.map((p, j) => {
            const n = countChars(p.body);
            const off = n < KAKUYOMU_POST_MIN || n > KAKUYOMU_POST_MAX;
            return (
              <div key={j} className="entry">
                <div className="row">
                  <span className="muted small-text">{j + 1}回目</span>
                  <input
                    className="grow"
                    value={p.title}
                    placeholder="サブタイトル"
                    onChange={(ev) =>
                      mutate((d) => {
                        const c = d.episodes[i].chapters[0];
                        const titles = c.sceneTitles ?? [];
                        titles[j] = ev.target.value;
                        c.sceneTitles = [...titles];
                      })
                    }
                  />
                  <CopyButton text={p.title} label="サブタイトルをコピー" />
                  <CopyButton text={p.body} label="本文をコピー" />
                </div>
                <small className={off ? "error" : "muted"}>
                  {n.toLocaleString()}字{off ? `(目安の${KAKUYOMU_POST_MIN.toLocaleString()}〜${KAKUYOMU_POST_MAX.toLocaleString()}字から外れています)` : ""}
                  ・{p.body.slice(0, 60).replace(/\n/g, " ")}…
                </small>
              </div>
            );
          })}
          {posts.length !== (e.chapters[0]?.beats.length ?? 0) && (
            <p className="muted small-text">
              ※本文の場面の数({posts.length})が構成の場面の数({e.chapters[0]?.beats.length ?? 0})と違います。本文の空行(場面の区切り)を確認してください。
            </p>
          )}
        </Section>
      ))}
    </div>
  );
}
