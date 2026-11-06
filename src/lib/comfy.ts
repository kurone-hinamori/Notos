import { fetch } from "@tauri-apps/plugin-http";
import type { Settings } from "../types";

type Url = Pick<Settings, "comfyUrl">;

const base = (s: Url) => s.comfyUrl.replace(/\/+$/, "");

/** ComfyUI も Origin ヘッダーを検査するので、Ollama と同じく ComfyUI 自身のオリジンを名乗る */
function headers(s: Url): Record<string, string> {
  try {
    return { "Content-Type": "application/json", Origin: new URL(base(s)).origin };
  } catch {
    return { "Content-Type": "application/json" };
  }
}

async function getJson<T>(s: Url, path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${base(s)}${path}`, { headers: headers(s), signal });
  if (!res.ok) throw new Error(`ComfyUI エラー ${res.status}`);
  return (await res.json()) as T;
}

const post = (s: Url, path: string, body: unknown) => fetch(`${base(s)}${path}`, { method: "POST", headers: headers(s), body: JSON.stringify(body) });

export interface ComfyModels {
  unet: string;
  clip: string;
  vae: string;
  /** 拡大用のモデル。なければ通常の拡大をする */
  upscale?: string;
  /** 画像を参照するための LoRA。なければ説明文だけで描く */
  editLora?: string;
}

async function modelsOf(s: Url, node: string, input: string): Promise<string[]> {
  const info = await getJson<Record<string, { input: { required: Record<string, unknown[]> } }>>(s, `/object_info/${node}`);
  const spec = info[node]?.input.required[input] ?? [];
  if (Array.isArray(spec[0])) return spec[0] as string[];
  return ((spec[1] as { options?: string[] } | undefined)?.options ?? []) as string[];
}

/** MOSS-Image に必要なモデルを探す。足りないときは、足りないファイルを示すエラーにする */
export async function detectComfy(s: Url): Promise<ComfyModels> {
  const [unets, clips, vaes, upscales, loras] = await Promise.all([
    modelsOf(s, "UNETLoader", "unet_name"),
    modelsOf(s, "CLIPLoader", "clip_name"),
    modelsOf(s, "VAELoader", "vae_name"),
    modelsOf(s, "UpscaleModelLoader", "model_name").catch(() => [] as string[]),
    modelsOf(s, "LoraLoaderModelOnly", "lora_name").catch(() => [] as string[]),
  ]);
  const unet = unets.find((m) => m.startsWith("moss_image_sft")) ?? unets.find((m) => m.startsWith("moss_image_base"));
  const clip = clips.find((m) => m.startsWith("qwen3.5_9b"));
  const vae = vaes.find((m) => m.startsWith("flux2-vae"));
  const missing = [
    !unet && "moss_image_base_int8_convrot.safetensors(models/diffusion_models)",
    !clip && "qwen3.5_9b_w4a8_gptq.safetensors(models/text_encoders)",
    !vae && "flux2-vae_small.safetensors(models/vae)",
  ].filter(Boolean);
  if (missing.length) throw new Error(`MOSS-Image のモデルが見つかりません:${missing.join("、")}`);
  return { unet: unet!, clip: clip!, vae: vae!, upscale: upscales.find((m) => /anime/i.test(m)) ?? upscales[0], editLora: loras.find((m) => m.startsWith("moss_image_edit")) };
}

/** 公式の推奨。短く保つ。作品は書籍として出すので、nsfw は常に入れる */
const NEGATIVE = "nsfw, worst quality, bad anatomy, watermark, jpeg artifact";

const negativeOf = (r: { negative?: string }) => (r.negative ? `${NEGATIVE}, ${r.negative}` : NEGATIVE);

export interface ImageRequest {
  prompt: string;
  width: number;
  height: number;
  /** 仕上がりの大きさ。生成の大きさと違えば拡大・切り抜きする */
  final?: [number, number];
  seed: number;
  /** 既定に足す否定のプロンプト */
  negative?: string;
  /** 参照する画像(models.editLora があるときだけ渡す) */
  references?: { name: string; bytes: Uint8Array }[];
}

const SAVE_NODE = "save";

/** ComfyUI の API 形式のワークフロー(公式テンプレートの MOSS-Image: Text to Image と同じ設定) */
export function mossWorkflow(m: ComfyModels, r: ImageRequest): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  const g: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
    unet: { class_type: "UNETLoader", inputs: { unet_name: m.unet, weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: m.clip, type: "moss_image", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: m.vae } },
    positive: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: r.prompt } },
    negative: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: negativeOf(r) } },
    latent: { class_type: "EmptyFlux2LatentImage", inputs: { width: r.width, height: r.height, batch_size: 1 } },
    sampler: {
      class_type: "KSampler",
      inputs: {
        model: ["unet", 0],
        seed: r.seed,
        steps: 25,
        cfg: 2.5,
        sampler_name: "er_sde",
        scheduler: "simple",
        positive: ["positive", 0],
        negative: ["negative", 0],
        latent_image: ["latent", 0],
        denoise: 1,
      },
    },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sampler", 0], vae: ["vae", 0] } },
  };
  // 参照あり:公式テンプレートの MOSS-Image: Image Edit と同じ設定
  const refs = r.references ?? [];
  if (refs.length && m.editLora) {
    g.lora = { class_type: "LoraLoaderModelOnly", inputs: { model: ["unet", 0], lora_name: m.editLora, strength_model: 1 } };
    g.slg = { class_type: "SkipLayerGuidanceDiTSimple", inputs: { model: ["lora", 0], double_layers: "", single_layers: "22", start_percent: 0, end_percent: 1 } };
    const images: Record<string, [string, number]> = {};
    refs.forEach((ref, i) => {
      g[`ref${i}`] = { class_type: "LoadImage", inputs: { image: ref.name } };
      g[`refScaled${i}`] = { class_type: "ImageScaleToTotalPixels", inputs: { image: [`ref${i}`, 0], upscale_method: "lanczos", megapixels: 1, resolution_steps: 16 } };
      images[`images.image_${i}`] = [`refScaled${i}`, 0];
    });
    const encode = (text: string) => ({
      class_type: "TextEncodeMOSSImageEdit",
      inputs: { clip: ["clip", 0], prompt: text, edit_format: "Moss-Image-Edit", image_strength: 1, vae: ["vae", 0], ...images },
    });
    g.positive = encode(r.prompt);
    g.negative = encode(negativeOf(r));
    Object.assign(g.sampler.inputs, { model: ["slg", 0], steps: 30, cfg: 4, sampler_name: "euler", scheduler: "normal" });
  }
  let image: [string, number] = ["decode", 0];
  if (r.final && (r.final[0] !== r.width || r.final[1] !== r.height)) {
    if (m.upscale && (r.final[0] > r.width || r.final[1] > r.height)) {
      g.upscaler = { class_type: "UpscaleModelLoader", inputs: { model_name: m.upscale } };
      g.upscaled = { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: ["upscaler", 0], image } };
      image = ["upscaled", 0];
    }
    g.scale = { class_type: "ImageScale", inputs: { image, upscale_method: "lanczos", width: r.final[0], height: r.final[1], crop: "center" } };
    image = ["scale", 0];
  }
  // 利用者の ComfyUI の output フォルダーを増やさないよう、一時ファイルとして受け取る
  g[SAVE_NODE] = { class_type: "PreviewImage", inputs: { images: image } };
  return g;
}

interface HistoryEntry {
  status?: { status_str?: string; messages?: [string, { exception_message?: string; node_type?: string }][] };
  outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/** 参照する画像を ComfyUI の input フォルダーに送る(同じ名前なら上書きする) */
async function uploadImage(s: Url, name: string, bytes: Uint8Array): Promise<string> {
  const form = new FormData();
  form.append("image", new Blob([bytes as BlobPart], { type: "image/png" }), name);
  form.append("overwrite", "true");
  const { "Content-Type": _, ...rest } = headers(s);
  const res = await fetch(`${base(s)}/upload/image`, { method: "POST", headers: rest, body: form });
  if (!res.ok) throw new Error(`参照する画像を送れませんでした(${res.status})`);
  return ((await res.json()) as { name: string }).name;
}

/** 画像を1枚作って PNG で受け取る。中断すると ComfyUI 側の処理も止める */
export async function generateImage(
  s: Url,
  models: ComfyModels,
  req: ImageRequest,
  signal: AbortSignal,
  onStatus: (text: string) => void,
): Promise<Uint8Array> {
  const references = [];
  for (const ref of req.references ?? []) references.push({ ...ref, name: await uploadImage(s, ref.name, ref.bytes) });
  const res = await post(s, "/prompt", { prompt: mossWorkflow(models, { ...req, references }), client_id: "notos" });
  const sent = (await res.json().catch(() => ({}))) as { prompt_id?: string; error?: { message?: string }; node_errors?: unknown };
  if (!res.ok || !sent.prompt_id) throw new Error(`ComfyUI が受け付けませんでした:${sent.error?.message ?? res.status}`);
  const id = sent.prompt_id;
  const started = Date.now();

  for (;;) {
    if (signal.aborted) {
      await post(s, "/queue", { delete: [id] }).catch(() => undefined);
      const q = await getJson<{ queue_running: unknown[][] }>(s, "/queue").catch(() => ({ queue_running: [] }));
      if (q.queue_running.some((x) => x[1] === id)) await post(s, "/interrupt", {}).catch(() => undefined);
      throw new DOMException("中断しました", "AbortError");
    }
    const history = await getJson<Record<string, HistoryEntry>>(s, `/history/${id}`);
    const h = history[id];
    if (h) {
      if (h.status?.status_str !== "success") {
        const e = h.status?.messages?.find(([k]) => k === "execution_error")?.[1];
        throw new Error(`画像を作れませんでした:${e?.exception_message?.trim() ?? "ComfyUI のログを確認してください"}`);
      }
      const im = h.outputs?.[SAVE_NODE]?.images?.[0];
      if (!im) throw new Error("ComfyUI から画像を受け取れませんでした");
      const q = new URLSearchParams({ filename: im.filename, subfolder: im.subfolder, type: im.type });
      const file = await fetch(`${base(s)}/view?${q}`, { headers: headers(s) });
      if (!file.ok) throw new Error(`画像を受け取れませんでした(${file.status})`);
      return new Uint8Array(await file.arrayBuffer());
    }
    onStatus(`画像を生成中(${Math.round((Date.now() - started) / 1000)}秒)`);
    await sleep(1500, signal);
  }
}
