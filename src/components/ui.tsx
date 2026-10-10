import { useState, type ReactNode } from "react";
import type { Story } from "../types";
import { hasLine, parseLines } from "../lib/text";

/**
 * 「使ってほしいセリフ」の入力欄(1行に1つ)。
 * story を渡すと、各セリフが本文で使われているかも表示する。
 */
export function LinesField(props: { lines: string[]; onChange: (lines: string[]) => void; story?: Story; label?: string }) {
  // 入力途中の空行を保つため、入力欄の文字列はここで持つ
  const [text, setText] = useState(() => props.lines.join("\n"));
  const lines = parseLines(text);
  const chapters = props.story?.chapters ?? [];
  const written = chapters.some((c) => c.body.trim());
  return (
    <label className="field">
      <span>{props.label ?? "使ってほしいセリフ(1行に1つ。本文で必ずそのまま使います)"}</span>
      <textarea
        rows={3}
        value={text}
        placeholder={"例:「それでも、私は行くよ」\n例:レン「約束は、破るためにあるんじゃない」"}
        onChange={(e) => {
          setText(e.target.value);
          props.onChange(parseLines(e.target.value));
        }}
      />
      {written && lines.length > 0 && (
        <ul className="line-status">
          {lines.map((l) => {
            const at = chapters.findIndex((c) => hasLine(c.body, l));
            return (
              <li key={l} className={at >= 0 ? "ok" : ""}>
                {at >= 0 ? `✔ ${chapters.length > 1 ? `第${at + 1}章で使用` : "使用済み"}` : "― 未使用"}:{l}
              </li>
            );
          })}
        </ul>
      )}
      <small className="muted">
        話者を決めたい場合は「レン「…」」のように書きます。どの場面で使うかは構成の作成時に決まり、書いた後に本文へ入っているかを確認します。
      </small>
    </label>
  );
}

export function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { label, value, onChange, rows, placeholder, disabled } = props;
  return (
    <label className="field">
      <span>{label}</span>
      {rows ? (
        <textarea value={value} rows={rows} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

export function Section(props: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <header className="card-head">
        <h3>{props.title}</h3>
        <div className="row">{props.actions}</div>
      </header>
      {props.children}
    </section>
  );
}

export function StatusBadge({ status }: { status: "concept" | "producing" | "done" }) {
  const label = { concept: "企画", producing: "執筆中", done: "完成" }[status];
  return <span className={`badge badge-${status}`}>{label}</span>;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
