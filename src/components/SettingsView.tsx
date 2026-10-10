import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import type { Settings } from "../types";
import { listModels } from "../lib/ollama";
import { installUpdate } from "../lib/updater";
import { Field } from "./ui";

export function SettingsView(props: { settings: Settings; generating: boolean; onChange: (s: Settings) => void }) {
  const { settings, onChange } = props;
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [version, setVersion] = useState("");
  const [updateMsg, setUpdateMsg] = useState("");
  const [updating, setUpdating] = useState(false);

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

  /** 更新を確認し、新しい版があればそのままインストールして再起動する。 */
  const checkUpdate = async () => {
    setUpdating(true);
    setUpdateMsg("確認中…");
    try {
      const u = await check();
      if (!u) {
        setUpdateMsg("最新版です");
        return;
      }
      if (props.generating) {
        setUpdateMsg(`新しいバージョン ${u.version} があります。物語の生成中は再起動できないため、生成を止めてからもう一度お試しください。`);
        return;
      }
      setUpdateMsg(`新しいバージョン ${u.version} をダウンロード中… 0%`);
      await installUpdate(u, (p) => setUpdateMsg(`新しいバージョン ${u.version} をダウンロード中… ${p}%`));
      setUpdateMsg("更新しました。再起動します…");
    } catch (e) {
      setUpdateMsg(`更新できませんでした:${e instanceof Error ? e.message : e}`);
    } finally {
      setUpdating(false);
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
        <h3>表示</h3>
        <label className="field">
          <span>本文の文字の大きさ:{settings.bodyFontSize}px</span>
          <input
            type="range"
            min={12}
            max={28}
            step={1}
            value={settings.bodyFontSize}
            onChange={(e) => onChange({ ...settings, bodyFontSize: Number(e.target.value) })}
          />
        </label>
        <p className="font-preview" style={{ fontSize: settings.bodyFontSize }}>
          「それでも、私は行くよ」
          <br />
          彼女はそう言って、雨の上がった通りへ歩き出した。
        </p>
        <small className="muted">「本文」タブの入力欄と、生成中のプレビューに反映されます(EPUB の文字の大きさは、読むアプリ側で調整してください)。</small>
        <div className="row">
          <button className="small" disabled={settings.bodyFontSize === 15} onClick={() => onChange({ ...settings, bodyFontSize: 15 })}>
            標準(15px)に戻す
          </button>
        </div>
      </section>
      <section className="card">
        <h3>著者</h3>
        <Field label="筆名(EPUB の著者名になります)" value={settings.author} onChange={(v) => onChange({ ...settings, author: v })} />
      </section>
      <section className="card">
        <h3>アプリについて</h3>
        <p className="muted">Notos {version && `v${version}`}</p>
        <div className="row">
          <button disabled={updating} onClick={() => void checkUpdate()}>
            更新を確認してインストール
          </button>
          <span className="muted">{updateMsg}</span>
        </div>
      </section>
    </div>
  );
}
