import type { ReactNode } from "react";

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
