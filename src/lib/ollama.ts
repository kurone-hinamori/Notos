import { fetch } from "@tauri-apps/plugin-http";
import type { Settings } from "../types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  /** "json" または JSON Schema を渡すと構造化出力になる */
  format?: "json" | Record<string, unknown>;
  temperature?: number;
  numPredict?: number;
  signal?: AbortSignal;
  onToken?: (accumulated: string) => void;
}

const base = (s: Pick<Settings, "ollamaUrl">) => s.ollamaUrl.replace(/\/+$/, "");

export async function listModels(s: Pick<Settings, "ollamaUrl">): Promise<string[]> {
  const res = await fetch(`${base(s)}/api/tags`);
  if (!res.ok) throw new Error(`Ollama に接続できません (HTTP ${res.status})`);
  const data = (await res.json()) as { models?: { name: string }[] };
  return (data.models ?? []).map((m) => m.name);
}

function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*<\/think>/, "");
}

/** Ollama の /api/chat をストリーミングで呼び出し、全文を返す。 */
export async function chat(s: Settings, opts: ChatOptions): Promise<string> {
  if (!s.model) throw new Error("モデルが選択されていません。設定画面でモデルを選んでください。");
  const res = await fetch(`${base(s)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: opts.signal,
    body: JSON.stringify({
      model: s.model,
      messages: opts.messages,
      stream: true,
      think: false,
      format: opts.format,
      options: {
        temperature: opts.temperature ?? s.temperature,
        num_ctx: s.numCtx,
        num_predict: opts.numPredict ?? -1,
        repeat_penalty: 1.08,
      },
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama エラー (HTTP ${res.status}) ${detail}`.trim());
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const obj = JSON.parse(line) as { message?: { content?: string }; error?: string };
    if (obj.error) throw new Error(obj.error);
    if (obj.message?.content) {
      text += obj.message.content;
      opts.onToken?.(stripThinking(text));
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  handleLine(buffer);
  return stripThinking(text).trim();
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1)) as T;
    throw new Error("JSON を解釈できませんでした");
  }
}

/** 構造化出力。解釈に失敗した場合は最大 retries 回やり直す。 */
export async function chatJson<T>(
  s: Settings,
  opts: Omit<ChatOptions, "format"> & { schema: Record<string, unknown>; retries?: number },
): Promise<T> {
  const { schema, retries = 3, ...rest } = opts;
  let lastError: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      const text = await chat(s, { ...rest, format: schema, numPredict: rest.numPredict ?? 8192 });
      return parseJson<T>(text);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
