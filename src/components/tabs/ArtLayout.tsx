import { useEffect, useRef, useState } from "react";
import type { ArtBox } from "../../types";
import { textBox, thingBox } from "../../lib/art";
import { loadArt } from "../../lib/storage";

type Bbox = ArtBox["bbox"];

const ROLE_LABEL: Record<NonNullable<ArtBox["role"]>, string> = { title: "題名", subtitle: "サブタイトル", author: "著者名", free: "文字" };

/** 枠の短い名前(下絵と一覧に出す) */
export function boxLabel(b: ArtBox): string {
  if (b.kind === "text") return `${ROLE_LABEL[b.role ?? "free"]}:${(b.text ?? "").replace(/\n/g, " ").slice(0, 12) || "(空)"}`;
  if (b.kind === "character") return b.name ? `人物:${b.name}` : "人物";
  return `物:${b.captionJa.slice(0, 10) || "(説明なし)"}`;
}

/** 枠の英語が、日本語から訳し直されていない */
export const staleBox = (b: ArtBox) => !!b.captionJa.trim() && b.captionJa !== b.captionFrom;

const MIN = 40;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function useArtUrl(docId: string, file: string | undefined) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) return setUrl("");
    let alive = true;
    let made = "";
    void loadArt(docId, file)
      .then((bytes) => {
        made = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
        if (alive) setUrl(made);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [docId, file]);
  return url;
}

/**
 * 絵の中に人物・物・文字の枠を置く。枠はドラッグで動かし、右下の角で大きさを変える。
 * 下絵には採用中の画像を薄く出す。
 */
export function ArtLayoutEditor(props: {
  docId: string;
  boxes: ArtBox[];
  width: number;
  height: number;
  /** 下絵にする画像(採用中の画像) */
  backdrop?: string;
  /** キャラクターシートのある人物 */
  sheetNames: string[];
  /** 表紙などの題名・著者名(文字の枠の初期値) */
  title: string;
  author: string;
  /** 訳している枠の id */
  translating: string;
  onChange: (boxes: ArtBox[]) => void;
}) {
  const { boxes, onChange } = props;
  const [selected, setSelected] = useState<string>("");
  const [draft, setDraft] = useState<{ id: string; bbox: Bbox } | null>(null);
  const drag = useRef<{ id: string; mode: "move" | "resize"; x: number; y: number; bbox: Bbox; w: number; h: number } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const backdrop = useArtUrl(props.docId, props.backdrop);
  const sel = boxes.find((b) => b.id === selected);

  const update = (id: string, m: (b: ArtBox) => ArtBox) => onChange(boxes.map((b) => (b.id === id ? m(b) : b)));
  const add = (b: ArtBox) => {
    onChange([...boxes, b]);
    setSelected(b.id);
  };

  const start = (b: ArtBox, mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = canvas.current!.getBoundingClientRect();
    try {
      canvas.current!.setPointerCapture(e.pointerId);
    } catch {
      // 捕まえられなくても、枠の上で動かす分には困らない
    }
    drag.current = { id: b.id, mode, x: e.clientX, y: e.clientY, bbox: b.bbox, w: rect.width, h: rect.height };
    setSelected(b.id);
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = Math.round(((e.clientY - d.y) / d.h) * 1000);
    const dx = Math.round(((e.clientX - d.x) / d.w) * 1000);
    const [y0, x0, y1, x1] = d.bbox;
    let next: Bbox;
    if (d.mode === "move") {
      const my = clamp(dy, -y0, 1000 - y1);
      const mx = clamp(dx, -x0, 1000 - x1);
      next = [y0 + my, x0 + mx, y1 + my, x1 + mx];
    } else {
      next = [y0, x0, clamp(y1 + dy, y0 + MIN, 1000), clamp(x1 + dx, x0 + MIN, 1000)];
    }
    setDraft({ id: d.id, bbox: next });
  };

  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (d && draft?.id === d.id) update(d.id, (b) => ({ ...b, bbox: draft.bbox }));
    setDraft(null);
  };

  const shown = (b: ArtBox) => (draft?.id === b.id ? draft.bbox : b.bbox);
  const wide = props.width >= props.height;
  const hasRole = (role: ArtBox["role"]) => boxes.some((b) => b.kind === "text" && b.role === role);

  return (
    <div className="art-layout">
      <div
        ref={canvas}
        className="art-canvas"
        style={{ aspectRatio: `${props.width} / ${props.height}`, width: wide ? 420 : 260 }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerDown={() => setSelected("")}
      >
        {backdrop && <img className="art-canvas-backdrop" src={backdrop} alt="" draggable={false} />}
        {boxes.map((b, i) => {
          const [y0, x0, y1, x1] = shown(b);
          return (
            <div
              key={b.id}
              className={`art-box art-box-${b.kind}${b.id === selected ? " selected" : ""}`}
              style={{ top: `${y0 / 10}%`, left: `${x0 / 10}%`, height: `${(y1 - y0) / 10}%`, width: `${(x1 - x0) / 10}%` }}
              onPointerDown={start(b, "move")}
              title={boxLabel(b)}
            >
              <span className="art-box-label">
                {i + 1} {boxLabel(b)}
              </span>
              <span className="art-box-handle" onPointerDown={start(b, "resize")} />
            </div>
          );
        })}
      </div>

      <div className="art-layout-side stack">
        <div className="row wrap">
          <select
            style={{ width: "auto" }}
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === "#object") add(thingBox("object"));
              else if (v === "#person") add(thingBox("character"));
              else if (v) add(thingBox("character", v));
            }}
          >
            <option value="">＋ 人物・物の枠</option>
            {props.sheetNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            <option value="#person">(シートのない人物)</option>
            <option value="#object">(物・背景の一部)</option>
          </select>
          <select
            style={{ width: "auto" }}
            value=""
            onChange={(e) => {
              const role = e.target.value as NonNullable<ArtBox["role"]>;
              if (role === "title") add(textBox("title", props.title, [30, 60, 150, 940]));
              else if (role === "subtitle") add(textBox("subtitle", "", [155, 120, 245, 880]));
              else if (role === "author") add(textBox("author", props.author, [920, 620, 970, 960]));
              else if (role === "free") add(textBox("free", "", [450, 200, 550, 800]));
            }}
          >
            <option value="">＋ 文字の枠</option>
            <option value="title" disabled={hasRole("title")}>
              題名
            </option>
            <option value="subtitle" disabled={hasRole("subtitle")}>
              サブタイトル
            </option>
            <option value="author" disabled={hasRole("author")}>
              著者名(右下)
            </option>
            <option value="free">自由な文字</option>
          </select>
        </div>

        {!boxes.length && <p className="muted small-text">枠がなければ、説明文だけで描きます。</p>}
        {boxes.length > 0 && !sel && <p className="muted small-text">枠をクリックすると中身を直せます。ドラッグで動かし、右下の角で大きさを変えます。</p>}

        {sel && (
          <div className="art-box-detail stack">
            <div className="row">
              <strong className="grow">
                {boxes.indexOf(sel) + 1} {sel.kind === "text" ? ROLE_LABEL[sel.role ?? "free"] : sel.kind === "character" ? "人物" : "物"}
              </strong>
              <button className="small danger" onClick={() => (onChange(boxes.filter((b) => b.id !== sel.id)), setSelected(""))}>
                枠を削除
              </button>
            </div>
            {sel.kind === "character" && (
              <label className="field">
                <span>人物(外見はキャラクターシートの説明を使います)</span>
                <select value={sel.name ?? ""} onChange={(e) => update(sel.id, (b) => ({ ...b, name: e.target.value || undefined }))}>
                  <option value="">(シートなし。下の説明だけで描く)</option>
                  {props.sheetNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {sel.kind === "text" && (
              <label className="field">
                <span>描く文字(改行すると、その位置で行を分けます)</span>
                <textarea rows={2} value={sel.text ?? ""} onChange={(e) => update(sel.id, (b) => ({ ...b, text: e.target.value }))} />
              </label>
            )}
            <div className="art-bilingual">
              <label className="field">
                <span>{sel.kind === "text" ? "文字の見た目(日本語)" : sel.kind === "character" ? "ポーズや動作(日本語)" : "何を描くか(日本語)"}</span>
                <textarea
                  rows={3}
                  value={sel.captionJa}
                  placeholder={sel.kind === "character" ? "例:バットを肩に担いで、こちらに向かって歩いている" : ""}
                  onChange={(e) => update(sel.id, (b) => ({ ...b, captionJa: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>英語(生成に使います)</span>
                <textarea
                  rows={3}
                  className={staleBox(sel) ? "art-stale" : undefined}
                  value={sel.caption}
                  onChange={(e) => update(sel.id, (b) => ({ ...b, caption: e.target.value, captionFrom: b.captionJa }))}
                />
              </label>
            </div>
            {props.translating === sel.id ? (
              <span className="running small-text">● 英語に訳しています</span>
            ) : (
              staleBox(sel) && <span className="muted small-text">日本語を直しました。英語には、少し経つか「画像を作る」のときに訳し直します</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
