import { useCallback, useEffect, useRef, useState } from "react";
import type { Anthology, Doc, Settings, Story } from "./types";
import { isAnthology } from "./types";
import { isUndecided, loadStory, saveStory } from "./lib/storage";
import { pullConcept, runTask, summarizeCastChanges, type Ctx, type Task } from "./lib/pipeline";
import { applyConcept, conceptRequestFor, hasOpenIssues, historyTargets, isSeries, recordHistory, sharedContextFor } from "./lib/anthology";

export interface RunState {
  /** 実行中のドキュメント(長編または短編集)の id */
  docId: string | null;
  /** 実行中の物語の id(短編集の場合は話の id) */
  storyId: string | null;
  running: boolean;
  stage: string;
  stream: string;
  logs: string[];
  error: string;
}

/** 実行する作業の単位。episode を指定すると短編集のその話が対象になる。 */
export interface Job {
  task: Task;
  episode?: number;
  /** 短編集の話で、概要が未決定ならあらすじを自動で作ってから生成する(おまかせ生成) */
  auto?: boolean;
  /** 短編集の話で、生成はせずに経緯の更新だけを行う */
  historyOnly?: boolean;
}

const clock = (d: Date) => d.toLocaleTimeString("ja-JP", { hour12: false });

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分${s % 60}秒`;
  return `${Math.floor(m / 60)}時間${m % 60}分`;
}

const IDLE: RunState = { docId: null, storyId: null, running: false, stage: "", stream: "", logs: [], error: "" };

/**
 * 開いているドキュメント(長編または短編集)の保持・自動保存と、生成パイプラインの実行を担う。
 * 画面を移動しても生成が続くよう、App 直下で使う。
 */
export function useStoryManager(settings: Settings) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [run, setRun] = useState<RunState>(IDLE);
  const ref = useRef<Doc | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (ref.current) await saveStory(ref.current);
  }, []);

  const mutate = useCallback((mutator: (draft: Doc) => void) => {
    if (!ref.current) return;
    const next = structuredClone(ref.current);
    mutator(next);
    next.updatedAt = new Date().toISOString();
    ref.current = next;
    setDoc(next);
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
      setDoc(s);
    },
    [flush],
  );

  /** 新規作成したドキュメントを保存して開く。 */
  const adopt = useCallback(
    async (s: Doc) => {
      if (abort.current) throw new Error("生成中は新しい物語を作成できません。");
      await flush();
      await saveStory(s);
      ref.current = s;
      setDoc(s);
    },
    [flush],
  );

  const close = useCallback(async () => {
    await flush();
  }, [flush]);

  /** 長編ならドキュメントそのもの、短編集なら指定した話を読み書きする窓口を返す。 */
  const select = useCallback(
    (episode?: number) => {
      if (episode === undefined) {
        return {
          get: () => ref.current as Story,
          update: (m: (s: Story) => void) => mutate((d) => m(d as Story)),
        };
      }
      return {
        get: () => (ref.current as Anthology).episodes[episode],
        update: (m: (s: Story) => void) => mutate((d) => m((d as Anthology).episodes[episode])),
      };
    },
    [mutate],
  );

  /** 作業を順番に実行する(短編集の複数話の一括生成にも使う)。 */
  const execute = useCallback(
    async (jobs: Job[]) => {
      if (!ref.current || abort.current || !jobs.length) return;
      const docId = ref.current.id;
      const controller = new AbortController();
      abort.current = controller;
      setRun({ ...IDLE, docId, storyId: select(jobs[0].episode).get().id, running: true, stage: "準備中" });

      // ログには時刻を付け、工程ごとの所要時間も記録する(どこに時間がかかるかを調べるため)
      const pushLog = (msg: string) =>
        setRun((r) => ({ ...r, logs: [...r.logs.slice(-999), `${clock(new Date())}  ${msg}`] }));
      let stageLabel = "";
      let stageStart = Date.now();
      const endStage = () => {
        if (stageLabel && !stageLabel.endsWith("完了")) pushLog(`${stageLabel}  [所要 ${duration(Date.now() - stageStart)}]`);
        stageLabel = "";
      };
      const taskStart = Date.now();
      pushLog("開始");

      /** 連作短編で1話を書き終えたら、共通の設定(人物・場所・品物・用語)に起きた変化を経緯として記録する */
      const afterEpisode = async (ctx: Ctx, job: Job) => {
        const a = ref.current;
        if (!isAnthology(a) || !isSeries(a) || job.episode === undefined) return;
        if (!job.historyOnly && job.task.kind !== "all" && job.task.kind !== "chapter") return;
        const e = a.episodes[job.episode];
        const names = historyTargets(a, e);
        const written = e.chapters.length > 0 && e.chapters.every((c) => c.beats.length > 0 && c.sceneDone >= c.beats.length);
        if (!names.length || !written) return;
        ctx.stage("共通の設定の経緯を更新中");
        const changes = await summarizeCastChanges(ctx, names);
        mutate((d) => recordHistory(d as Anthology, e.id, changes));
        ctx.log(`共通の設定の経緯を更新しました(${changes.length}件)`);
      };

      /** おまかせ生成:概要が未決定の話のあらすじを、直前までの話を踏まえて自動で作る */
      const autoConcept = async (ctx: Ctx, index: number) => {
        const a = ref.current as Anthology;
        const e = a.episodes[index];
        ctx.stage("あらすじを作成中");
        const prep = { keywords: e.keywords, note: e.note ?? "", title: e.plannedTitle ?? "", lines: e.lines ?? [] };
        for (let attempt = 0; ; attempt++) {
          const c = await pullConcept(ctx.settings, conceptRequestFor(a, index, prep), ctx.signal);
          if (c.title && c.synopsis) {
            ctx.update((s) => applyConcept(s, c, prep.keywords, prep.note, prep.lines));
            ctx.log(`あらすじを作成しました:「${c.title}」`);
            return;
          }
          if (attempt >= 2) throw new Error("あらすじを作成できませんでした");
        }
      };

      try {
        for (const [n, job] of jobs.entries()) {
          const target = select(job.episode);
          const prefix = job.episode === undefined ? "" : `第${job.episode + 1}話 `;
          const storyId = target.get().id;
          setRun((r) => ({ ...r, storyId }));
          const ctx: Ctx = {
            settings: settingsRef.current,
            signal: controller.signal,
            get: target.get,
            update: target.update,
            stage: (label) => {
              endStage();
              stageLabel = prefix + label;
              stageStart = Date.now();
              setRun((r) => ({ ...r, stage: prefix + label, stream: "" }));
            },
            stream: (text) => setRun((r) => ({ ...r, stream: text })),
            log: (msg) => pushLog(prefix + msg),
          };
          if (job.episode !== undefined && isAnthology(ref.current)) {
            if (job.auto && isUndecided(target.get())) await autoConcept(ctx, job.episode);
            pushLog(`── ${prefix}「${target.get().title}」`);
            // 短編集の共通の設定・世界観・使用済みの名前を、生成の直前の状態で話に渡す
            const shared = sharedContextFor(ref.current, job.episode);
            target.update((s) => void (s.shared = shared));
          }
          if (!job.historyOnly) await runTask(ctx, job.task);
          if (job.episode !== undefined) await afterEpisode(ctx, job);

          const a = ref.current;
          if (job.episode !== undefined && isAnthology(a) && a.stopOnIssues && n < jobs.length - 1 && hasOpenIssues(a.episodes[job.episode])) {
            endStage();
            pushLog(`${prefix}に「要確認」の指摘が残っているため、次の話へ進まずに停止しました。確認後に、もう一度生成を始めてください。`);
            break;
          }
        }
        endStage();
        pushLog(`終了  [合計 ${duration(Date.now() - taskStart)}]`);
        setRun((r) => ({ ...r, running: false, stream: "", stage: r.stage.endsWith("完了") ? "完了" : "" }));
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
    [select, flush, mutate],
  );

  const start = useCallback((task: Task, episode?: number) => execute([{ task, episode }]), [execute]);

  const stop = useCallback(() => abort.current?.abort(), []);

  useEffect(() => {
    const onHide = () => {
      if (ref.current) void saveStory(ref.current);
    };
    window.addEventListener("beforeunload", onHide);
    return () => window.removeEventListener("beforeunload", onHide);
  }, []);

  return { doc, story: isAnthology(doc) ? null : doc, anthology: isAnthology(doc) ? doc : null, run, mutate, open, adopt, close, start, execute, stop, flush };
}
