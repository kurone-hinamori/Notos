import { fetch } from "@tauri-apps/plugin-http";
import type { ImageEngine, ImageFiles, Settings } from "../types";

type Url = Pick<Settings, "comfyUrl">;
type Conn = Pick<Settings, "comfyUrl" | "imageEngine" | "imageFiles">;

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
  engine: ImageEngine;
  unet: string;
  clip: string;
  vae: string;
  /** 拡大用のモデル。なければ通常の拡大をする */
  upscale?: string;
  /** 画像を参照するための LoRA(MOSS-Image)。なければ説明文だけで描く */
  editLora?: string;
}

export const ENGINE_LABEL: Record<ImageEngine, string> = { moss: "MOSS-Image", minimax_h3: "MiniMax-H3-Image" };

/** 画像生成のモデルが、シートの画像を参照できるか */
export const canReference = (m: ComfyModels) => m.engine === "minimax_h3" || !!m.editLora;

type FileKind = keyof Required<ImageFiles>;

/** モデルごとに自動で選ぶファイル(名前の先頭で探す)と、見つからないときに示すファイル */
const ENGINE_FILES: Record<ImageEngine, Record<FileKind, { prefixes: string[]; need: string }>> = {
  moss: {
    unet: { prefixes: ["moss_image_sft", "moss_image_base"], need: "moss_image_base_int8_convrot.safetensors(models/diffusion_models)" },
    clip: { prefixes: ["qwen3.5_9b"], need: "qwen3.5_9b_w4a8_gptq.safetensors(models/text_encoders)" },
    vae: { prefixes: ["flux2-vae"], need: "flux2-vae_small.safetensors(models/vae)" },
  },
  minimax_h3: {
    unet: { prefixes: ["minimax_h3_image"], need: "minimax_h3_image_pruned_int8_convrot.safetensors(models/diffusion_models)" },
    clip: { prefixes: ["qwen3vl_32b_minimax_h3"], need: "qwen3vl_32b_minimax_h3_int8_convrot.safetensors(models/text_encoders)" },
    vae: { prefixes: ["minimax_h3_image_vae"], need: "minimax_h3_image_vae_fp16.safetensors(models/vae)" },
  },
};

async function modelsOf(s: Url, node: string, input: string): Promise<string[]> {
  const info = await getJson<Record<string, { input: { required: Record<string, unknown[]> } }>>(s, `/object_info/${node}`);
  const spec = info[node]?.input.required[input] ?? [];
  if (Array.isArray(spec[0])) return spec[0] as string[];
  return ((spec[1] as { options?: string[] } | undefined)?.options ?? []) as string[];
}

/** ComfyUI にあるモデルのファイルの一覧(設定で選ぶため) */
export async function comfyFileLists(s: Url): Promise<Record<FileKind, string[]>> {
  const [unet, clip, vae] = await Promise.all([modelsOf(s, "UNETLoader", "unet_name"), modelsOf(s, "CLIPLoader", "clip_name"), modelsOf(s, "VAELoader", "vae_name")]);
  return { unet, clip, vae };
}

/** 自動で選ぶときのファイル(設定の画面で「自動」の中身を見せるため) */
export const autoFile = (engine: ImageEngine, kind: FileKind, list: string[]) =>
  ENGINE_FILES[engine][kind].prefixes.map((p) => list.find((m) => m.startsWith(p))).find(Boolean);

/** 設定で選んだモデルに必要なファイルを探す。足りないときは、足りないファイルを示すエラーにする */
export async function detectComfy(s: Conn): Promise<ComfyModels> {
  const engine = s.imageEngine ?? "moss";
  const [lists, upscales, loras] = await Promise.all([
    comfyFileLists(s),
    modelsOf(s, "UpscaleModelLoader", "model_name").catch(() => [] as string[]),
    modelsOf(s, "LoraLoaderModelOnly", "lora_name").catch(() => [] as string[]),
  ]);
  const own = s.imageFiles?.[engine] ?? {};
  const pick = (k: FileKind) => (own[k] ? lists[k].find((m) => m === own[k]) : autoFile(engine, k, lists[k]));
  const missing = (["unet", "clip", "vae"] as const).flatMap((k) => (pick(k) ? [] : [own[k] ? `${own[k]}(設定で選んだファイル)` : ENGINE_FILES[engine][k].need]));
  if (missing.length) throw new Error(`${ENGINE_LABEL[engine]} のモデルが見つかりません:${missing.join("、")}`);
  return {
    engine,
    unet: pick("unet")!,
    clip: pick("clip")!,
    vae: pick("vae")!,
    upscale: upscales.find((m) => /anime/i.test(m)) ?? upscales[0],
    editLora: engine === "moss" ? loras.find((m) => m.startsWith("moss_image_edit")) : undefined,
  };
}

/** 公式の推奨。短く保つ。作品は書籍として出すので、nsfw は常に入れる */
export const DEFAULT_NEGATIVE = "nsfw, worst quality, bad anatomy, watermark, jpeg artifact";
const NEGATIVE = DEFAULT_NEGATIVE;

const negativeOf = (r: { negative?: string; baseNegative?: string }) => {
  const base = r.baseNegative?.trim() ? (/nsfw/i.test(r.baseNegative) ? r.baseNegative.trim() : `nsfw, ${r.baseNegative.trim()}`) : NEGATIVE;
  return r.negative ? `${base}, ${r.negative}` : base;
};

/** 0〜1000 の [上, 左, 下, 右] */
export type Box1000 = [number, number, number, number];

export interface ImageRequest {
  prompt: string;
  width: number;
  height: number;
  /** 仕上がりの大きさ。生成の大きさと違えば拡大・切り抜きする */
  final?: [number, number];
  seed: number;
  /** 既定に足す否定のプロンプト(MiniMax-H3-Image では効かない) */
  negative?: string;
  /** 既定の代わりに使う否定のプロンプト(nsfw は必ず入れる) */
  baseNegative?: string;
  /** 参照する画像 */
  references?: { name: string; bytes: Uint8Array }[];
  /** 描き直す元の画像と、描き直す範囲。範囲の外は元の画像のまま残す */
  redraw?: { name: string; bytes: Uint8Array; boxes: Box1000[] };
}

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

const SAVE_NODE = "save";

/** 1枚の処理がこれより長ければ、止まったとみなす(4人を参照して拡大まで含めても10分ほどだった) */
const STALL_MS = 25 * 60_000;
/** ComfyUI に送られてからこれより長く処理中なら、止まったとみなす */
const STALL_QUEUED_MS = 60 * 60_000;

/** 範囲を塗ったマスク(w×h)を作り、そのノードの名前を返す */
function maskNodes(g: Graph, id: string, w: number, h: number, boxes: Box1000[]): string {
  g[`${id}_base`] = { class_type: "SolidMask", inputs: { value: 0, width: w, height: h } };
  let last = `${id}_base`;
  boxes.forEach(([y0, x0, y1, x1], i) => {
    const x = Math.max(0, Math.floor((x0 * w) / 1000));
    const y = Math.max(0, Math.floor((y0 * h) / 1000));
    const bw = Math.max(8, Math.min(w, Math.ceil((x1 * w) / 1000)) - x);
    const bh = Math.max(8, Math.min(h, Math.ceil((y1 * h) / 1000)) - y);
    g[`${id}_box${i}`] = { class_type: "SolidMask", inputs: { value: 1, width: bw, height: bh } };
    g[`${id}_add${i}`] = { class_type: "MaskComposite", inputs: { destination: [last, 0], source: [`${id}_box${i}`, 0], x, y, operation: "add" } };
    last = `${id}_add${i}`;
  });
  return last;
}

/** 描き直すとき:元の画像を描く大きさにして、範囲の外は元のままにする潜在画像 */
function redrawLatent(g: Graph, image: string, w: number, h: number, boxes: Box1000[]): [string, number] {
  g.redrawSrc = { class_type: "LoadImage", inputs: { image } };
  g.redrawGen = { class_type: "ImageScale", inputs: { image: ["redrawSrc", 0], upscale_method: "lanczos", width: w, height: h, crop: "center" } };
  g.redrawEnc = { class_type: "VAEEncode", inputs: { pixels: ["redrawGen", 0], vae: ["vae", 0] } };
  g.redrawNoise = { class_type: "SetLatentNoiseMask", inputs: { samples: ["redrawEnc", 0], mask: [maskNodes(g, "genMask", w, h, boxes), 0] } };
  return ["redrawNoise", 0];
}

/** 描き直した画像を、仕上がりの大きさの元の画像に、範囲だけ(境目はぼかして)重ねる */
function redrawComposite(g: Graph, image: [string, number], w: number, h: number, boxes: Box1000[]): [string, number] {
  g.redrawFinal = { class_type: "ImageScale", inputs: { image: ["redrawSrc", 0], upscale_method: "lanczos", width: w, height: h, crop: "center" } };
  g.redrawMaskImage = { class_type: "MaskToImage", inputs: { mask: [maskNodes(g, "finalMask", w, h, boxes), 0] } };
  const radius = Math.max(4, Math.min(31, Math.round(Math.min(w, h) / 120)));
  g.redrawBlur = { class_type: "ImageBlur", inputs: { image: ["redrawMaskImage", 0], blur_radius: radius, sigma: radius / 2 } };
  g.redrawSoft = { class_type: "ImageToMask", inputs: { image: ["redrawBlur", 0], channel: "red" } };
  g.redrawComp = { class_type: "ImageCompositeMasked", inputs: { destination: ["redrawFinal", 0], source: image, x: 0, y: 0, resize_source: false, mask: ["redrawSoft", 0] } };
  return ["redrawComp", 0];
}

/** MOSS-Image のワークフロー(公式テンプレートの MOSS-Image: Text to Image / Image Edit と同じ設定) */
function mossGraph(m: ComfyModels, r: ImageRequest): { g: Graph; image: [string, number] } {
  const g: Graph = {
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
  if (r.redraw) {
    g.sampler.inputs.latent_image = redrawLatent(g, r.redraw.name, r.width, r.height, r.redraw.boxes);
    delete g.latent;
  }
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
  return { g, image };
}

/** MiniMax-H3-Image は 4MP より小さいと崩れる(公式の注意)ので、仕上がりの縦横比のまま約4MPで描く */
export function h3Size(w: number, h: number): [number, number] {
  const k = Math.sqrt(4_194_304 / (w * h));
  const round = (v: number) => Math.max(1024, Math.round((v * k) / 32) * 32);
  return [round(w), round(h)];
}

/** MiniMax-H3-Image のワークフロー(公式テンプレートと同じ:6ステップ、CFG 1、ネガティブなし) */
function h3Graph(m: ComfyModels, r: ImageRequest): { g: Graph; image: [string, number] } {
  const [tw, th] = r.final ?? [r.width, r.height];
  const [gw, gh] = h3Size(tw, th);
  const images: Record<string, [string, number]> = {};
  const g: Graph = {
    unet: { class_type: "UNETLoader", inputs: { unet_name: m.unet, weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: m.clip, type: "minimax", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: m.vae } },
  };
  (r.references ?? []).forEach((ref, i) => {
    g[`ref${i}`] = { class_type: "LoadImage", inputs: { image: ref.name } };
    g[`refScaled${i}`] = { class_type: "ImageScaleToTotalPixels", inputs: { image: [`ref${i}`, 0], upscale_method: "lanczos", megapixels: 1, resolution_steps: 32 } };
    images[`images.image_${i + 1}`] = [`refScaled${i}`, 0];
  });
  let prompt = r.prompt;
  if (r.redraw) {
    // 描き直すときは元の絵も見せる(見せないと、描き直した所だけ白っぽい板のようになり、背景となじまなかった)
    const n = Object.keys(images).length + 1;
    g.redrawRef = { class_type: "LoadImage", inputs: { image: r.redraw.name } };
    g.redrawRefScaled = { class_type: "ImageScaleToTotalPixels", inputs: { image: ["redrawRef", 0], upscale_method: "lanczos", megapixels: 1, resolution_steps: 32 } };
    images[`images.image_${n}`] = ["redrawRefScaled", 0];
    prompt += `\n<Picture ${n}> is the current version of this same illustration. Keep its background, colors and lighting, and blend seamlessly with it.`;
  }
  g.positive = { class_type: "MiniMaxH3ImageConditioning", inputs: { clip: ["clip", 0], vae: ["vae", 0], prompt, width: gw, height: gh, ...images } };
  g.negative = { class_type: "ConditioningZeroOut", inputs: { conditioning: ["positive", 0] } };
  g.sampler = {
    class_type: "KSampler",
    inputs: {
      model: ["unet", 0],
      seed: r.seed,
      steps: 6,
      cfg: 1,
      sampler_name: "euler",
      scheduler: "simple",
      positive: ["positive", 0],
      negative: ["negative", 0],
      latent_image: r.redraw ? redrawLatent(g, r.redraw.name, gw, gh, r.redraw.boxes) : ["positive", 1],
      denoise: 1,
    },
  };
  g.decode = { class_type: "VAEDecode", inputs: { samples: ["sampler", 0], vae: ["vae", 0] } };
  let image: [string, number] = ["decode", 0];
  if (gw !== tw || gh !== th) {
    g.scale = { class_type: "ImageScale", inputs: { image, upscale_method: "lanczos", width: tw, height: th, crop: "center" } };
    image = ["scale", 0];
  }
  return { g, image };
}

/** ComfyUI の API 形式のワークフロー */
export function comfyWorkflow(m: ComfyModels, r: ImageRequest): Graph {
  const { g, image: drawn } = m.engine === "minimax_h3" ? h3Graph(m, r) : mossGraph(m, r);
  const [w, h] = r.final ?? [r.width, r.height];
  // 描き直したときは、範囲の外を元の画像のまま残す
  const image = r.redraw ? redrawComposite(g, drawn, w, h, r.redraw.boxes) : drawn;
  // 利用者の ComfyUI の output フォルダーを増やさないよう、一時ファイルとして受け取る
  g[SAVE_NODE] = { class_type: "PreviewImage", inputs: { images: image } };
  return g;
}

/** テスト用のスクリプトが使う、以前の名前 */
export const mossWorkflow = (m: Omit<ComfyModels, "engine"> & { engine?: ImageEngine }, r: ImageRequest) => comfyWorkflow({ ...m, engine: m.engine ?? "moss" }, r);

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
  const redraw = req.redraw && { ...req.redraw, name: await uploadImage(s, req.redraw.name, req.redraw.bytes) };
  const res = await post(s, "/prompt", { prompt: comfyWorkflow(models, { ...req, references, redraw }), client_id: "notos" });
  const sent = (await res.json().catch(() => ({}))) as { prompt_id?: string; error?: { message?: string }; node_errors?: unknown };
  if (!res.ok || !sent.prompt_id) throw new Error(`ComfyUI が受け付けませんでした:${sent.error?.message ?? res.status}`);
  const id = sent.prompt_id;
  const started = Date.now();
  // ComfyUI で処理中の作業と、それを最初に見た時刻(止まった作業の後ろに並ぶと、自分の番が来ないため)
  let runningId = "";
  let deadline = 0;
  let checked = 0;

  for (;;) {
    if (signal.aborted) {
      await post(s, "/queue", { delete: [id] }).catch(() => undefined);
      const q = await getJson<{ queue_running: unknown[][] }>(s, "/queue").catch(() => ({ queue_running: [] }));
      if (q.queue_running.some((x) => x[1] === id)) await post(s, "/interrupt", {}).catch(() => undefined);
      throw new DOMException("中断しました", "AbortError");
    }
    const history = await getJson<Record<string, HistoryEntry>>(s, `/history/${id}`).catch((e: unknown) => {
      throw new Error(`生成の途中で ComfyUI との接続が切れました。ComfyUI が終了していないか確認してください(${e instanceof Error ? e.message : String(e)})`);
    });
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
    // GPU のエラーで ComfyUI の処理が止まると、処理中のまま終わらない。長すぎたら知らせる
    if (Date.now() - checked > 10_000) {
      checked = Date.now();
      const q = await getJson<{ queue_running: unknown[][] }>(s, "/queue").catch(() => null);
      const running = q?.queue_running[0];
      const rid = typeof running?.[1] === "string" ? running[1] : "";
      if (rid !== runningId) {
        runningId = rid;
        // 見てから25分。送られた時刻が分かれば、そこから60分でも止まったとみなす
        // (アプリを開く前から止まっていた作業もすぐ分かるように。順番待ちの時間も含むので長めにする)
        const created = (running?.[3] as { create_time?: number } | undefined)?.create_time;
        deadline = rid ? Math.min(Date.now() + STALL_MS, typeof created === "number" ? created + STALL_QUEUED_MS : Infinity) : 0;
      }
    }
    if (deadline && Date.now() > deadline) {
      await post(s, "/queue", { delete: [id] }).catch(() => undefined);
      throw new Error(
        `ComfyUI の処理が長い時間進んでいません。ComfyUI のコンソールに「unspecified launch failure」などのエラーが出ていれば、ComfyUI を起動し直してから作り直してください。`,
      );
    }
    onStatus(`画像を生成中(${Math.round((Date.now() - started) / 1000)}秒)`);
    await sleep(1500, signal);
  }
}
