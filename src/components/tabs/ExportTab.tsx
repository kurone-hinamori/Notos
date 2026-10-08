import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { buildEpub, type Book } from "../../lib/epub";
import { Field, Section } from "../ui";

/** 縦書き EPUB の出力画面(長編・短編集で共用)。 */
export function ExportTab(props: {
  title: string;
  /** この本に設定した著者名(空なら defaultAuthor を使う) */
  author: string;
  defaultAuthor: string;
  onAuthor: (v: string) => void;
  hasBody: boolean;
  /** 短編集の場合の補足説明 */
  note?: string;
  makeBook: (author: string, includeBible: boolean) => Book;
}) {
  const [includeBible, setIncludeBible] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const exportEpub = async () => {
    setMessage("");
    setBusy(true);
    try {
      const safe = props.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "notos";
      const path = await save({ defaultPath: `${safe}.epub`, filters: [{ name: "EPUB", extensions: ["epub"] }] });
      if (!path) return;
      const data = await buildEpub(props.makeBook(props.author || props.defaultAuthor, includeBible));
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
        <p className="muted">縦書き・右開き(右から左へ読み進める)のEPUB 3 を出力します。章ごとに目次が付きます。</p>
        {props.note && <p className="muted">{props.note}</p>}
        <Field
          label="著者名(空欄の場合は設定画面の筆名)"
          value={props.author}
          placeholder={props.defaultAuthor || "Notos"}
          onChange={props.onAuthor}
        />
        <label className="check">
          <input type="checkbox" checked={includeBible} onChange={(e) => setIncludeBible(e.target.checked)} />
          巻末に設定資料(登場人物・地名・品物)を付ける
        </label>
        <div className="row">
          <button className="primary" disabled={!props.hasBody || busy} onClick={() => void exportEpub()}>
            {busy ? "出力中…" : "EPUBとして保存"}
          </button>
          {!props.hasBody && <span className="muted">本文がまだありません。</span>}
        </div>
        {message && <p className={message.startsWith("出力に失敗") ? "error" : "muted"}>{message}</p>}
      </Section>
    </div>
  );
}
