import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import type { Settings } from "../types";
import { listModels } from "../lib/ollama";
import { Field } from "./ui";

export function SettingsView(props: { settings: Settings; onChange: (s: Settings) => void }) {
  const { settings, onChange } = props;
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [version, setVersion] = useState("");
  const [updateMsg, setUpdateMsg] = useState("");

  const refresh = async () => {
    setStatus({ ok: true, text: "接続を確認中…" });
    try {
      const list = await listModels(settings);
      setModels(list);
      setStatus({ ok: true, text: `接続できました(モデル ${list.length} 件)` });
      if (!settings.model && list.length) onChange({ ...settings, model: list[0] });
    } catch (e) {
      setModels([]);
      setStatus({ ok: false, text: `接続できません。Ollama が起動しているか確認してください。(${e instanceof Error ? e.message : e})` });
    }
  };

  useEffect(() => {
    void refresh();
    getVersion().then(setVersion).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkUpdate = async () => {
    setUpdateMsg("確認中…");
    try {
      const u = await check();
      setUpdateMsg(u ? `新しいバージョン ${u.version} があります(起動時のバナーから更新できます)` : "最新版です");
    } catch (e) {
      setUpdateMsg(`確認できませんでした:${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <div className="page narrow">
      <header className="page-head">
        <h2>設定</h2>
      </header>
      <section className="card">
        <h3>ローカルLLM(Ollama)</h3>
        <Field label="Ollama の URL" value={settings.ollamaUrl} onChange={(v) => onChange({ ...settings, ollamaUrl: v })} />
        <div className="row">
          <button onClick={() => void refresh()}>接続確認・モデル一覧を更新</button>
          {status && <span className={status.ok ? "muted" : "error"}>{status.text}</span>}
        </div>
        <label className="field">
          <span>使用するモデル</span>
          <select value={settings.model} onChange={(e) => onChange({ ...settings, model: e.target.value })}>
            {!models.includes(settings.model) && <option value={settings.model}>{settings.model || "(未選択)"}</option>}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>温度(創造性):{settings.temperature.toFixed(2)}</span>
          <input type="range" min={0.2} max={1.2} step={0.05} value={settings.temperature} onChange={(e) => onChange({ ...settings, temperature: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>コンテキスト長(num_ctx)</span>
          <select value={settings.numCtx} onChange={(e) => onChange({ ...settings, numCtx: Number(e.target.value) })}>
            {[8192, 16384, 32768, 65536].map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </select>
          <small className="muted">大きいほど設定資料や前章の要約を多く参照できますが、メモリを消費します。</small>
        </label>
      </section>
      <section className="card">
        <h3>著者</h3>
        <Field label="筆名(EPUB の著者名になります)" value={settings.author} onChange={(v) => onChange({ ...settings, author: v })} />
      </section>
      <section className="card">
        <h3>アプリについて</h3>
        <p className="muted">Notos {version && `v${version}`}</p>
        <div className="row">
          <button onClick={() => void checkUpdate()}>更新を確認</button>
          <span className="muted">{updateMsg}</span>
        </div>
      </section>
    </div>
  );
}
