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
      const ctx: Ctx = {
        settings: settingsRef.current,
        signal: controller.signal,
        get: () => ref.current!,
        update: (m) => mutate(m),
        stage: (label) => setRun((r) => ({ ...r, stage: label, stream: "" })),
        stream: (text) => setRun((r) => ({ ...r, stream: text })),
        log: (msg) => setRun((r) => ({ ...r, logs: [...r.logs.slice(-199), msg] })),
      };
      try {
        await runTask(ctx, task);
        setRun((r) => ({ ...r, running: false, stream: "", stage: r.stage === "完了" ? "完了" : "" }));
      } catch (e) {
        const aborted = controller.signal.aborted;
        setRun((r) => ({
          ...r,
          running: false,
          stream: "",
          stage: "",
          error: aborted ? "" : e instanceof Error ? e.message : String(e),
          logs: aborted ? [...r.logs, "中断しました(続きから再開できます)"] : r.logs,
        }));
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
