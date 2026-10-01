import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { Story } from "../../types";
import type { Mutate } from "../StoryDetail";
import { buildEpub } from "../../lib/epub";
import { Field, Section } from "../ui";

export function ExportTab({ story, author, mutate }: { story: Story; author: string; mutate: Mutate }) {
  const [includeBible, setIncludeBible] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const hasBody = story.chapters.some((c) => c.body);

  const exportEpub = async () => {
    setMessage("");
    setBusy(true);
    try {
      const safe = story.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "notos";
      const path = await save({ defaultPath: `${safe}.epub`, filters: [{ name: "EPUB", extensions: ["epub"] }] });
      if (!path) return;
      const data = await buildEpub({ ...story, author: story.author || author }, { includeBible });
      await writeFile(path, data);
      setMessage(`保存しました:${path}`);
    } catch (e) {
      setMessage(`出力に失敗しました:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <Section title="縦書きEPUBの出力">
        <p className="muted">
          縦書き・右開き(右から左へ読み進める)のEPUB 3 を出力します。章ごとに目次が付きます。
        </p>
        <Field
          label="著者名(空欄の場合は設定画面の筆名)"
          value={story.author}
          placeholder={author || "Notos"}
          onChange={(v) => mutate((s) => void (s.author = v))}
        />
        <label className="check">
          <input type="checkbox" checked={includeBible} onChange={(e) => setIncludeBible(e.target.checked)} />
          巻末に設定資料(登場人物・地名・品物)を付ける
        </label>
        <div className="row">
          <button className="primary" disabled={!hasBody || busy} onClick={() => void exportEpub()}>
            {busy ? "出力中…" : "EPUBとして保存"}
          </button>
          {!hasBody && <span className="muted">本文がまだありません。</span>}
        </div>
        {message && <p className={message.startsWith("出力に失敗") ? "error" : "muted"}>{message}</p>}
      </Section>
    </div>
  );
}
