import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { ArtImage, ArtItem, ArtKind, ArtSet, CharacterSheet, Doc, Settings } from "../../types";
import { isAnthology } from "../../types";
import type { ArtJob } from "../../hooks";
import { ART_KINDS, ART_KIND_ORDER, DEFAULT_ART_STYLE, artCharacters, artPlaces, artNegative, artReferences, chosenImage, emptyArt, exportArtImage, fullArtPrompt, newArtItem, toGrayscale } from "../../lib/art";
import { detectComfy, generateImage, type ComfyModels } from "../../lib/comfy";
import { generateArtCaption, generateArtLooks, translateArtText } from "../../lib/pipeline";
import { artCaptionPrompt, artLooksPrompt, artTranslatePrompt } from "../../lib/prompts";
import { deleteArt, loadArt, saveArt } from "../../lib/storage";
import { newId, sameName } from "../../lib/text";
import { Section } from "../ui";

export interface ArtControl {
  job: ArtJob | null;
  start: (docId: string, itemId: string, work: (signal: AbortSignal, stage: (text: string) => void) => Promise<void>) => Promise<void>;
  stop: () => void;
  update: (id: string, mutator: (draft: Doc) => void) => Promise<void> | void;
}

const MAX_SEED = 2 ** 40;

const worldOf = (doc: Doc) => (isAnthology(doc) ? (doc.world ?? "") : doc.bible.worldview);
const genreOf = (doc: Doc) => (isAnthology(doc) ? (doc.genre ?? "") : doc.genre);
const synopsisOf = (doc: Doc) => (isAnthology(doc) ? doc.episodes.map((e) => e.synopsis).filter(Boolean).join(" ") : doc.synopsis);

/** 作った説明文を入れる(日本語と英語はそろっている扱いにする) */
function setCaption(x: ArtItem, r: { caption: string; captionJa: string }) {
  x.prompt = r.caption;
  x.promptJa = r.captionJa || undefined;
  x.promptFrom = x.promptJa;
  x.promptEdited = false;
}

/** 保存した画像を表示する */
function ArtThumb(props: { docId: string; image: ArtImage; selected: boolean; onClick: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    let made = "";
    void loadArt(props.docId, props.image.file)
      .then((bytes) => {
        made = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
        if (alive) setUrl(made);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [props.docId, props.image.file]);
  return (
    <button className={`art-thumb${props.selected ? " selected" : ""}`} onClick={props.onClick} title={`シード ${props.image.seed}`}>
      {url ? <img src={url} alt="" /> : <span className="muted small-text">読み込み中</span>}
    </button>
  );
}

function ArtItemCard(props: {
  doc: Doc;
  art: ArtSet;
  item: ArtItem;
  characters: CharacterSheet[];
  models: ComfyModels | null;
  settings: Settings;
  running: boolean;
  control: ArtControl;
}) {
  const { doc, art, item, characters, models, settings, control } = props;
  const k = ART_KINDS[item.kind];
  const [zoom, setZoom] = useState<ArtImage | null>(null);
  const [message, setMessage] = useState("");
  const [count, setCount] = useState(1);
  const docId = doc.id;
  const places = artPlaces(doc);
  const place = places.find((p) => p.key === item.place);
  const job = control.job;
  const mine = job?.docId === docId && job.itemId === item.id;
  const busy = !!job && !job.error;

  /** このカードの項目を書き換える(生成の途中で別の物語を開いても、元の物語に残す) */
  const patch = (m: (x: ArtItem) => void) =>
    control.update(docId, (d) => {
      const x = d.art?.items.find((i) => i.id === item.id);
      if (x) m(x);
    });

  const writeCaption = () =>
    void control.start(docId, item.id, async (signal, stage) => {
      stage("説明文を作成中");
      const base = { title: doc.title, genre: genreOf(doc), world: worldOf(doc) };
      if (item.kind === "sheet") {
        const character = characters.find((c) => sameName(c.name, item.characters[0] ?? ""));
        if (!character) throw new Error("この人物は設定資料にありません");
        const r = await generateArtLooks(settings, artLooksPrompt({ ...base, character }), signal);
        await patch((x) => {
          setCaption(x, r);
          x.notHuman = !r.human || undefined;
        });
        return;
      }
      const scene = k.place === "scene" ? (place?.scenes[item.scene ?? 0] ?? "") : k.place === "chapter" ? (place?.scenes[0] ?? "") : "";
      const r = await generateArtCaption(
        settings,
        artCaptionPrompt({ ...base, kind: k.label, synopsis: synopsisOf(doc), scene, request: item.title === k.label ? "" : item.title, characters }),
        signal,
      );
      const names = r.characters.filter((n) => characters.some((c) => sameName(c.name, n))).slice(0, 3);
      await patch((x) => {
        setCaption(x, r);
        if (k.people && !x.characters.length) x.characters = names;
      });
    });

  // ---- 日本語と英語の説明 ----
  const [translating, setTranslating] = useState<"" | "en" | "ja">("");
  const [translateError, setTranslateError] = useState("");
  const translation = useRef<AbortController | null>(null);
  /** 日本語を直したのに、英語がまだ訳し直されていない */
  const stale = !!item.promptJa?.trim() && item.promptJa !== item.promptFrom;
  const castOf = () => {
    const chosen = characters.filter((c) => item.characters.some((n) => sameName(c.name, n)));
    return chosen.length || item.kind === "sheet" ? chosen : characters.slice(0, 8);
  };

  const translate = async (to: "en" | "ja", text: string, signal: AbortSignal) => {
    // 直す前の日本語と英語があれば渡し、変わっていない部分の英語を保つ
    const previous = to === "en" && item.promptFrom?.trim() && item.prompt.trim() ? { ja: item.promptFrom, en: item.prompt } : undefined;
    return translateArtText(settings, artTranslatePrompt({ text, to, sheet: item.kind === "sheet", characters: castOf(), previous }), signal);
  };

  /** カードの中で訳す(生成の順番待ちとは別に動かす) */
  const translateHere = async (to: "en" | "ja") => {
    translation.current?.abort();
    const ac = new AbortController();
    translation.current = ac;
    setTranslating(to);
    setTranslateError("");
    try {
      if (to === "en") {
        const ja = item.promptJa ?? "";
        const en = await translate("en", ja, ac.signal);
        if (ac.signal.aborted) return;
        await patch((x) => {
          x.prompt = en;
          x.promptFrom = ja;
          x.promptEdited = false;
        });
      } else {
        const ja = await translate("ja", item.prompt, ac.signal);
        if (ac.signal.aborted) return;
        await patch((x) => {
          x.promptJa = ja;
          x.promptFrom = ja;
          x.promptEdited = false;
        });
      }
    } catch (e) {
      if (!ac.signal.aborted) setTranslateError(`訳せませんでした:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (translation.current === ac) {
        translation.current = null;
        setTranslating("");
      }
    }
  };

  // 日本語を直したら、手が止まって少し経ってから英語に訳し直す
  const working = mine && busy;
  useEffect(() => {
    if (!stale || working) return;
    const timer = setTimeout(() => void translateHere("en"), 1500);
    return () => clearTimeout(timer);
  }, [item.promptJa, item.promptFrom, working]);

  useEffect(() => () => translation.current?.abort(), []);

  const editJa = (value: string) => {
    translation.current?.abort();
    setTranslateError("");
    void patch((x) => void (x.promptJa = value));
  };

  const editEn = (value: string) => {
    // 直接直した英語は、日本語を直すまでそのまま使う
    if (translating === "en") translation.current?.abort();
    void patch((x) => {
      x.prompt = value;
      x.promptFrom = x.promptJa;
      x.promptEdited = !!x.promptJa?.trim();
    });
  };

  const generate = () =>
    void control.start(docId, item.id, async (signal, stage) => {
      translation.current?.abort();
      let current = item;
      if (stale) {
        // 訳し直しが済んでいなければ、先に訳してから描く
        stage("英語に訳しています");
        const ja = item.promptJa ?? "";
        const en = await translate("en", ja, signal);
        current = { ...item, prompt: en, promptFrom: ja, promptEdited: false };
        await patch((x) => {
          x.prompt = en;
          x.promptFrom = ja;
          x.promptEdited = false;
        });
      }
      const m = models ?? (await detectComfy(settings));
      for (let n = 0; n < count; n++) {
        const prefix = count > 1 ? `${n + 1}/${count}枚目:` : "";
        const seed = Math.floor(Math.random() * MAX_SEED);
        const [width, height] = item.size ?? [k.width, k.height];
        // LoRA がなければ、参照せず説明文だけで描く
        const target = m.editLora ? current : { ...current, noReference: true };
        const prompt = fullArtPrompt(art, target);
        const references = [];
        for (const f of artReferences(art, target)) references.push({ name: `notos_${f}.png`, bytes: await loadArt(docId, f) });
        const png = await generateImage(settings, m, { prompt, width, height, final: k.final, seed, references, negative: artNegative(current) }, signal, (t) => stage(prefix + t));
        const bytes = k.mono ? await toGrayscale(png) : png;
        const file = newId();
        await saveArt(docId, file, bytes);
        const [w, h] = k.final ?? [width, height];
        await patch((x) => {
          x.images.push({ file, seed, prompt, width: w, height: h, createdAt: new Date().toISOString() });
          x.chosen ??= file;
        });
      }
    });

  const saveFile = async (image: ArtImage) => {
    setMessage("");
    try {
      const safe = `${doc.title}_${item.title}`.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
      const path = await save({ defaultPath: `${safe}.jpg`, filters: [{ name: "JPEG", extensions: ["jpg"] }] });
      if (!path) return;
      await writeFile(path, await exportArtImage(doc, item, image.file, doc.author || settings.author));
      setMessage(`保存しました:${path}`);
    } catch (e) {
      setMessage(`保存に失敗しました:${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const removeImage = async (image: ArtImage) => {
    if (!window.confirm("この画像を削除しますか?")) return;
    setZoom(null);
    await deleteArt(docId, image.file);
    await patch((x) => {
      x.images = x.images.filter((y) => y.file !== image.file);
      if (x.chosen === image.file) x.chosen = x.images.at(-1)?.file;
    });
  };

  const removeItem = async () => {
    if (!window.confirm(`「${item.title}」と作った画像をすべて削除しますか?`)) return;
    for (const image of item.images) await deleteArt(docId, image.file);
    await control.update(docId, (d) => {
      if (d.art) d.art.items = d.art.items.filter((i) => i.id !== item.id);
    });
  };

  const chosen = chosenImage(item);
  const referable = artReferences(art, { ...item, noReference: false }).length;
  const sheetNames = art.items.filter((i) => i.kind === "sheet" && i.prompt.trim()).map((i) => i.characters[0]);

  return (
    <div className="entry">
      <div className="row">
        {item.kind === "sheet" ? (
          <strong className="grow">{item.title}</strong>
        ) : (
          <input className="grow" value={item.title} placeholder="名前(作者の希望として説明文の作成にも使います)" onChange={(e) => void patch((x) => void (x.title = e.target.value))} />
        )}
        <button className="small danger" disabled={mine && busy} onClick={() => void removeItem()}>
          削除
        </button>
      </div>

      {k.place && (
        <div className="row wrap">
          <select
            style={{ width: "auto" }}
            value={item.place ?? ""}
            onChange={(e) =>
              void patch((x) => {
                x.place = e.target.value || undefined;
                x.scene = 0;
              })
            }
          >
            <option value="">(入れる場所を選択)</option>
            {places.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          {k.place === "scene" && place && (
            <select style={{ width: "auto" }} value={item.scene ?? 0} onChange={(e) => void patch((x) => void (x.scene = Number(e.target.value)))}>
              {place.scenes.map((s, i) => (
                <option key={i} value={i}>
                  場面{i + 1}の後:{s.slice(0, 20)}…
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {item.kind === "free" && (
        <div className="row wrap">
          <label className="row">
            <span className="muted small-text">幅</span>
            <input type="number" step={16} min={512} max={2048} style={{ width: 90 }} value={item.size?.[0] ?? k.width} onChange={(e) => void patch((x) => void (x.size = [snap(e.target.value), x.size?.[1] ?? k.height]))} />
          </label>
          <label className="row">
            <span className="muted small-text">高さ</span>
            <input type="number" step={16} min={512} max={2048} style={{ width: 90 }} value={item.size?.[1] ?? k.height} onChange={(e) => void patch((x) => void (x.size = [x.size?.[0] ?? k.width, snap(e.target.value)]))} />
          </label>
        </div>
      )}

      {k.people && (
        <div className="art-people">
          <span className="muted small-text">描く人物:</span>
          {sheetNames.length === 0 && <span className="muted small-text">キャラクターシートで外見を決めると選べます</span>}
          {sheetNames.map((name) => (
            <label key={name} className="check">
              <input
                type="checkbox"
                checked={item.characters.includes(name)}
                onChange={(e) =>
                  void patch((x) => {
                    x.characters = e.target.checked ? [...x.characters, name] : x.characters.filter((n) => n !== name);
                  })
                }
              />
              {name}
            </label>
          ))}
        </div>
      )}

      <div className="art-bilingual">
        <label className="field">
          <span>{item.kind === "sheet" ? "外見の説明(日本語。直すと英語も直ります)" : "絵の説明(日本語。直すと英語も直ります)"}</span>
          <textarea
            rows={5}
            value={item.promptJa ?? ""}
            placeholder={item.prompt.trim() ? "「英語から日本語を作る」で訳せます" : "「説明文を作る」で作るか、日本語で書いてください"}
            onChange={(e) => editJa(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{item.kind === "sheet" ? "英語(画像の生成とほかの画像に使います)" : "英語(画像の生成に使います)"}</span>
          <textarea rows={5} className={stale ? "art-stale" : undefined} value={item.prompt} onChange={(e) => editEn(e.target.value)} />
        </label>
      </div>
      <div className="row wrap">
        {translating === "en" ? (
          <span className="running small-text">● 英語に訳しています</span>
        ) : translating === "ja" ? (
          <span className="running small-text">● 日本語に訳しています</span>
        ) : stale ? (
          <span className="muted small-text">日本語を直しました。少し経つと英語に訳し直します</span>
        ) : item.promptEdited ? (
          <span className="muted small-text">英語を直接直しました(日本語には反映されていません)</span>
        ) : null}
        {!translating && item.prompt.trim() && (!item.promptJa?.trim() || item.promptEdited) && (
          <button className="small" disabled={working} onClick={() => void translateHere("ja")}>
            英語から日本語を作る
          </button>
        )}
        {!translating && translateError && stale && (
          <button className="small" disabled={working} onClick={() => void translateHere("en")}>
            英語に訳し直す
          </button>
        )}
      </div>
      {translateError && <p className="error small-text">{translateError}</p>}

      <div className="row wrap">
        <button className="small" disabled={busy || props.running} onClick={writeCaption}>
          説明文を作る
        </button>
        <button className="small primary" disabled={busy || !models || !(item.prompt.trim() || item.promptJa?.trim())} onClick={generate}>
          画像を作る
        </button>
        <select style={{ width: "auto" }} value={count} onChange={(e) => setCount(Number(e.target.value))}>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}枚
            </option>
          ))}
        </select>
        {models?.editLora && referable > 0 && (
          <label className="check" title="人物の見た目が揃いやすくなりますが、時間は長くかかります">
            <input type="checkbox" checked={!item.noReference} onChange={(e) => void patch((x) => void (x.noReference = !e.target.checked))} />
            シートの画像を参照する({referable}人)
          </label>
        )}
        {item.kind === "sheet" && (
          <label className="check" title="人が持った絵や、人の姿にならないようにします">
            <input type="checkbox" checked={!!item.notHuman} onChange={(e) => void patch((x) => void (x.notHuman = e.target.checked || undefined))} />
            人ではない(ロボット・動物・物など)
          </label>
        )}
        {item.kind === "cover" && (
          <label className="check">
            <input type="checkbox" checked={item.coverText !== false} onChange={(e) => void patch((x) => void (x.coverText = e.target.checked))} />
            保存とEPUBで題名と著者名を入れる
          </label>
        )}
        {mine && busy && (
          <>
            <span className="running">● {job.stage}</span>
            <button className="small" onClick={control.stop}>
              停止
            </button>
          </>
        )}
      </div>
      {mine && job.error && <p className="error small-text">{job.error}</p>}
      {message && <p className={message.startsWith("保存に失敗") ? "error small-text" : "muted small-text"}>{message}</p>}

      {item.images.length > 0 && (
        <div className="art-gallery">
          {item.images.map((image) => (
            <ArtThumb key={image.file} docId={docId} image={image} selected={image.file === chosen?.file} onClick={() => setZoom(image)} />
          ))}
        </div>
      )}

      {zoom && (
        <div className="art-zoom" onClick={() => setZoom(null)}>
          <div className="art-zoom-body" onClick={(e) => e.stopPropagation()}>
            <ArtThumb docId={docId} image={zoom} selected={false} onClick={() => setZoom(null)} />
            <div className="row wrap">
              <span className="muted small-text">
                {zoom.width}×{zoom.height}
              </span>
              <button
                className="small primary"
                disabled={zoom.file === chosen?.file}
                onClick={() => void patch((x) => void (x.chosen = zoom.file))}
              >
                {zoom.file === chosen?.file ? "採用中" : "これを採用する"}
              </button>
              <button className="small" onClick={() => void saveFile(zoom)}>
                JPEGで保存
              </button>
              <button className="small danger" onClick={() => void removeImage(zoom)}>
                削除
              </button>
              <button className="small" onClick={() => setZoom(null)}>
                閉じる
              </button>
            </div>
            <small className="muted">シード {zoom.seed}</small>
          </div>
        </div>
      )}
    </div>
  );
}

/** 画像の大きさは16の倍数にする */
const snap = (v: string) => Math.min(2048, Math.max(512, Math.round((Number(v) || 1024) / 16) * 16));

/** 表紙・口絵・挿絵などを ComfyUI(MOSS-Image)で作る画面 */
export function ArtTab(props: { doc: Doc; settings: Settings; running: boolean; art: ArtControl }) {
  const { doc, settings, art: control } = props;
  const art = doc.art ?? emptyArt();
  const [models, setModels] = useState<ComfyModels | null>(null);
  const [status, setStatus] = useState("接続を確認中…");
  const characters = artCharacters(doc);
  const checked = useRef("");

  const check = async () => {
    setStatus("接続を確認中…");
    try {
      const m = await detectComfy(settings);
      setModels(m);
      setStatus(`接続しました:${m.unet}${m.upscale ? ` / 拡大:${m.upscale}` : ""}${m.editLora ? " / シートの画像の参照:可" : " / シートの画像の参照:不可(説明文だけで描きます)"}`);
    } catch (e) {
      setModels(null);
      const text = e instanceof Error ? e.message : String(e);
      setStatus(text.startsWith("MOSS-Image") ? text : `ComfyUI に接続できません(${settings.comfyUrl})。起動しているか確認してください。`);
    }
  };

  useEffect(() => {
    if (checked.current === settings.comfyUrl) return;
    checked.current = settings.comfyUrl;
    void check();
  }, [settings.comfyUrl]);

  const add = (item: ArtItem) =>
    void control.update(doc.id, (d) => {
      d.art ??= emptyArt();
      d.art.items.push(item);
    });

  const addSheet = (name: string) => add({ ...newArtItem("sheet", name), characters: [name] });

  const withoutSheet = characters.filter((c) => !art.items.some((i) => i.kind === "sheet" && sameName(i.characters[0] ?? "", c.name)));

  const sectionOf = (kind: ArtKind) => {
    const k = ART_KINDS[kind];
    const items = art.items.filter((i) => i.kind === kind);
    return (
      <Section
        key={kind}
        id={`art-${kind}`}
        title={k.label}
        actions={
          kind !== "sheet" && (k.many || !items.length) ? (
            <button className="small" onClick={() => add(newArtItem(kind))}>
              ＋ 追加
            </button>
          ) : undefined
        }
      >
        <p className="muted small-text">{k.desc}</p>
        {kind === "sheet" && withoutSheet.length > 0 && (
          <div className="row wrap">
            {withoutSheet.map((c) => (
              <button key={c.name} className="small" onClick={() => addSheet(c.name)}>
                ＋ {c.name}
              </button>
            ))}
          </div>
        )}
        {items.map((item) => (
          <ArtItemCard key={item.id} doc={doc} art={art} item={item} characters={characters} models={models} settings={settings} running={props.running} control={control} />
        ))}
      </Section>
    );
  };

  return (
    <div className="stack">
      <Section title="画像生成の準備">
        <div className="row wrap">
          <span className={models ? "muted small-text" : "error small-text"}>{status}</span>
          <button className="small" onClick={() => void check()}>
            再確認
          </button>
        </div>
        <label className="field">
          <span>画風(英語。すべての画像に使います)</span>
          <textarea
            rows={2}
            value={art.style}
            onChange={(e) =>
              void control.update(doc.id, (d) => {
                d.art ??= emptyArt();
                d.art.style = e.target.value;
              })
            }
          />
        </label>
        {art.style !== DEFAULT_ART_STYLE && (
          <div className="row">
            <button
              className="small"
              onClick={() =>
                void control.update(doc.id, (d) => {
                  if (d.art) d.art.style = DEFAULT_ART_STYLE;
                })
              }
            >
              既定の画風に戻す
            </button>
          </div>
        )}
        <p className="muted small-text">
          作り方:キャラクターシートで人物の外見を決め、次に表紙や挿絵で描く人物を選びます。シートで採用した画像は参照に使います(1枚につき4人まで)。「説明文を作る」で小説用のモデルが説明文を書き、「画像を作る」でComfyUIが生成します。採用した画像はEPUBに入ります。
        </p>
      </Section>
      {ART_KIND_ORDER.map(sectionOf)}
    </div>
  );
}
