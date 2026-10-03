import { useCallback, useEffect, useRef, useState } from "react";
import type { Settings, Story } from "./types";
import { loadStory, saveStory } from "./lib/storage";
import { runTask, type Ctx, type Task } from "./lib/pipeline";

export interface RunState {
  storyId: string | null;
  running: boolean;
  stage: string;
  stream: string;
  logs: string[];
  error: string;
}

const clock = (d: Date) => d.toLocaleTimeString("ja-JP", { hour12: false });

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分${s % 60}秒`;
  return `${Math.floor(m / 60)}時間${m % 60}分`;
}

const IDLE: RunState = { storyId: null, running: false, stage: "", stream: "", logs: [], error: "" };

/**
 * 開いている物語の保持・自動保存と、生成パイプラインの実行を担う。
 * 画面を移動しても生成が続くよう、App 直下で使う。
 */
export function useStoryManager(settings: Settings) {
  const [story, setStory] = useState<Story | null>(null);
  const [run, setRun] = useState<RunState>(IDLE);
  const ref = useRef<Story | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (ref.current) await saveStory(ref.current);
  }, []);

  const mutate = useCallback((mutator: (draft: Story) => void) => {
    if (!ref.current) return;
    const next = structuredClone(ref.current);
    mutator(next);
    next.updatedAt = new Date().toISOString();
    ref.current = next;
    setStory(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      if (ref.current) void saveStory(ref.current);
    }, 500);
  }, []);

  const open = useCallback(
    async (id: string) => {
      if (ref.current?.id === id) return;
      if (abort.current) throw new Error("生成中は別の物語を開けません。停止してから開いてください。");
      await flush();
      const s = await loadStory(id);
      ref.current = s;
      setStory(s);
    },
    [flush],
  );

  /** 新規作成した物語を保存して開く。 */
  const adopt = useCallback(
    async (s: Story) => {
      if (abort.current) throw new Error("生成中は新しい物語を作成できません。");
      await flush();
      await saveStory(s);
      ref.current = s;
      setStory(s);
    },
    [flush],
  );

  const close = useCallback(async () => {
    await flush();
  }, [flush]);

  const start = useCallback(
    async (task: Task) => {
      if (!ref.current || abort.current) return;
      const storyId = ref.current.id;
      const controller = new AbortController();
      abort.current = controller;
      setRun({ ...IDLE, storyId, running: true, stage: "準備中" });

      // ログには時刻を付け、工程ごとの所要時間も記録する(どこに時間がかかるかを調べるため)
      const pushLog = (msg: string) =>
        setRun((r) => ({ ...r, logs: [...r.logs.slice(-999), `${clock(new Date())}  ${msg}`] }));
      let stageLabel = "";
      let stageStart = Date.now();
      const endStage = () => {
        if (stageLabel && stageLabel !== "完了") pushLog(`${stageLabel}  [所要 ${duration(Date.now() - stageStart)}]`);
        stageLabel = "";
      };
      const taskStart = Date.now();
      pushLog("開始");

      const ctx: Ctx = {
        settings: settingsRef.current,
        signal: controller.signal,
        get: () => ref.current!,
        update: (m) => mutate(m),
        stage: (label) => {
          endStage();
          stageLabel = label;
          stageStart = Date.now();
          setRun((r) => ({ ...r, stage: label, stream: "" }));
        },
        stream: (text) => setRun((r) => ({ ...r, stream: text })),
        log: pushLog,
      };
      try {
        await runTask(ctx, task);
        endStage();
        pushLog(`終了  [合計 ${duration(Date.now() - taskStart)}]`);
        setRun((r) => ({ ...r, running: false, stream: "", stage: r.stage === "完了" ? "完了" : "" }));
      } catch (e) {
        const aborted = controller.signal.aborted;
        const message = e instanceof Error ? e.message : String(e);
        endStage();
        pushLog(`${aborted ? "中断しました(続きから再開できます)" : `エラー:${message}`}  [合計 ${duration(Date.now() - taskStart)}]`);
        setRun((r) => ({ ...r, running: false, stream: "", stage: "", error: aborted ? "" : message }));
      } finally {
        abort.current = null;
        await flush();
      }
    },
    [mutate, flush],
  );

  const stop = useCallback(() => abort.current?.abort(), []);

  useEffect(() => {
    const onHide = () => {
      if (ref.current) void saveStory(ref.current);
    };
    window.addEventListener("beforeunload", onHide);
    return () => window.removeEventListener("beforeunload", onHide);
  }, []);

  return { story, run, mutate, open, adopt, close, start, stop, flush };
}
