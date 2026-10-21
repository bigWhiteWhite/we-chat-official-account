"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";
import { api, type TaskDetail } from "@/lib/api";
import { useUiStore } from "@/store/ui";

import { StepChannel } from "./step-channel";
import { StepImages } from "./step-images";
import { StepPublish, type PublishState } from "./step-publish";
import { usePublish } from "./use-publish";
import { StepReview } from "./step-review";
import { StepScript } from "./step-script";
import { StepSubjects } from "./step-subjects";

const STEPS = ["通道选择", "剧本创作", "主体确认", "漫画生成", "人工审核", "发布"] as const;

/** 主体已确认及其后的状态：进入漫画生成/后续步骤的门槛 */
const SUBJECT_DONE = [
  "subjects_ready",
  "drawing",
  "reviewing",
  "review_passed",
  "publishing",
  "done",
];

/** 进行中的状态：这些状态下工作流轮询任务，续看服务端进度 */
const IN_PROGRESS = ["collecting", "writing", "drawing", "publishing"];

/** 按任务状态把工作流定位到对应步骤（刷新后续接） */
/** 任务已推进到的最远步骤（0 基）；用于允许点击回看已完成步骤 */
function maxReachedStep(task: TaskDetail | null): number {
  if (!task) return 0;
  let max = 1;
  if (task.script) max = 2;
  if (task.subjectBindings) max = 3;
  const imgs = task.images ?? [];
  const pc = task.script?.panels.length ?? 0;
  if (pc > 0 && imgs.length === pc && imgs.every(Boolean)) max = 4;
  if (task.reviewResult === "pass" || ["review_passed", "publishing", "done"].includes(task.status))
    max = 5;
  return max;
}

function stepForStatus(task: TaskDetail): number {
  switch (task.status) {
    case "collecting":
    case "writing":
    case "script_ready":
      return 1;
    case "subjects_ready":
    case "drawing":
      return 3;
    case "reviewing":
      return 4;
    case "review_passed":
    case "publishing":
    case "done":
      return 5;
    case "failed":
    case "stopped": {
      const imgs = task.images ?? [];
      const allImgs =
        imgs.length > 0 && imgs.length === (task.script?.panels.length ?? 0) && imgs.every(Boolean);
      if (allImgs) return 4;
      return task.subjectBindings ? 3 : 1;
    }
    case "rejected":
      return 4;
    default:
      return 1;
  }
}

export function WorkflowWizard() {
  const modal = useUiStore((s) => s.modal);
  const closeWizard = useUiStore((s) => s.closeWizard);
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [outline, setOutline] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  /** 本集画风（合集多画风选择；默认第一个画风） */
  const [seriesStyleId, setSeriesStyleId] = useState<string | null>(null);
  const [carryContext, setCarryContext] = useState(false);
  const [castIds, setCastIds] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [isResumed, setIsResumed] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const pub: PublishState & { publish: () => Promise<void>; reset: () => void } =
    usePublish(taskId);

  const comicLayout = useUiStore((s) => s.comicLayout);
  const { data: task } = useQuery({
    queryKey: ["task", taskId, comicLayout],
    queryFn: () => api.getTask(taskId!, comicLayout),
    enabled: !!taskId,
    retry: false,
    refetchInterval: (query) => {
      const t = query.state.data as TaskDetail | undefined;
      return t && IN_PROGRESS.includes(t.status) ? 2500 : false;
    },
  });

  // 打开工作流：带 taskId 则续接已有任务（按状态定位步骤），否则新建
  useEffect(() => {
    if (modal !== "wizard") return;
    const tid = useUiStore.getState().wizardTaskId;
    if (tid) {
      setTaskId(tid);
      setIsResumed(true);
      setResuming(true);
      setStep(0);
    } else {
      setTaskId(null);
      setIsResumed(false);
      setResuming(false);
      setStep(0);
      setOutline("");
      setTagIds([]);
      setSeriesId(useUiStore.getState().wizardSeriesId);
      setSeriesStyleId(null);
      setCarryContext(false);
      setCastIds([]);
      setMaxVisited(0);
    }
  }, [modal]);

  // 续接：任务加载后按状态定位步骤
  useEffect(() => {
    if (resuming && task) {
      setStep(stepForStatus(task));
      setMaxVisited(stepForStatus(task));
      setResuming(false);
    }
  }, [resuming, task]);

  // 记录当前会话内到达过的最远步骤，用于“回看模式”提示
  useEffect(() => {
    setMaxVisited((m) => Math.max(m, step));
  }, [step]);

  if (modal !== "wizard") return null;

  function close() {
    closeWizard();
    setStep(0);
    setTaskId(null);
    setSeriesStyleId(null);
    setOutline("");
    setTagIds([]);
    setSeriesId(null);
    setCarryContext(false);
    setCastIds([]);
    setStreaming(false);
    setIsResumed(false);
    setResuming(false);
    setStopping(false);
    setReviewNote("");
    setReviewing(false);
    setMaxVisited(0);
    pub.reset();
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  }

  /** 切换合集：切到“不加入合集”时清空本集出场角色 */
  function handleSeriesChange(id: string | null) {
    setSeriesId(id);
    if (!id) {
      setCastIds([]);
      setSeriesStyleId(null);
    }
  }

  async function start() {
    if (starting) return;
    setStarting(true);
    try {
      const trimmedOutline = outline.trim();
      const sourceType = trimmedOutline ? "user-outline" : "self-made";
      const r = await api.createTask(
        sourceType,
        trimmedOutline || undefined,
        tagIds.length > 0 ? tagIds : undefined,
        seriesId ?? undefined,
        carryContext || undefined,
        castIds.length > 0 && seriesId ? castIds : undefined,
        seriesId ? (seriesStyleId ?? undefined) : undefined,
      );
      setTaskId(r.taskId);
      setStep(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建任务失败");
    } finally {
      setStarting(false);
    }
  }

  function goNext() {
    void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }

  function goBack() {
    if (step === 0 || (isResumed && step === 1)) {
      close();
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    setStep((s) => Math.max(0, s - 1));
  }

  const step1CanNext = !!task?.script && !streaming;
  const step2CanNext = !!task?.subjectBindings && SUBJECT_DONE.includes(task?.status ?? "");
  const imagePaths = task?.images ?? [];
  const panelCount = task?.script?.panels.length ?? 0;
  const step3CanNext =
    panelCount > 0 && imagePaths.length === panelCount && imagePaths.every(Boolean);

  const taskInProcess = !!task && IN_PROGRESS.includes(task.status);

  const maxStep = maxReachedStep(task ?? null);
  const progressStep = Math.max(maxVisited, maxStep);
  function stepClickable(i: number): boolean {
    if (resuming || i === step) return false;
    if (i === 0) return !isResumed;
    return i <= maxStep;
  }
  function goToStep(i: number) {
    void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    setStep(i);
  }

  async function stopGen() {
    if (!taskId || stopping) return;
    setStopping(true);
    try {
      await api.stopTask(taskId);
      toast.success("任务已停止");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "停止失败");
    } finally {
      setStopping(false);
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    }
  }

  async function passReview() {
    if (!taskId || reviewing) return;
    setReviewing(true);
    try {
      await api.review(taskId, "pass", reviewNote.trim() || undefined);
      toast.success("已通过审核");
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      goNext();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "审核操作失败");
    } finally {
      setReviewing(false);
    }
  }

  const backLabel = step === 0 ? "取消" : isResumed && step === 1 ? "关闭" : "上一步";

  return (
    <div
      className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-slate-900/40 p-4"
      onClick={close}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative border-b border-slate-100 px-6 py-4">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={close}
            aria-label="关闭"
            className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
          >
            <XIcon />
          </Button>
          <h2 className="text-lg font-semibold">{isResumed ? "继续工作流" : "新建生产"}</h2>
          <ol className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2">
            {STEPS.map((label, i) => (
              <li key={label} className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!stepClickable(i)}
                  onClick={() => goToStep(i)}
                  title={stepClickable(i) ? undefined : "该步骤尚未完成"}
                  style={{ cursor: stepClickable(i) ? "pointer" : "default" }}
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                    i < step
                      ? "bg-emerald-500 text-white"
                      : i === step
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {i + 1}
                </button>
                <span
                  className={`text-sm ${i === step ? "font-medium text-slate-900" : "text-slate-400"}`}
                >
                  {label}
                </span>
                {i < STEPS.length - 1 && <span className="h-px w-5 bg-slate-200" />}
              </li>
            ))}
          </ol>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {resuming ? (
            <p className="py-10 text-center text-sm text-slate-400">正在载入任务…</p>
          ) : (
            <>
              {!resuming && task && step < maxVisited && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
                  <span>
                    回看模式：当前进度在第 {progressStep + 1} 步「{STEPS[progressStep]}
                    」。可自由查看各步骤；在此步骤修改后，后续步骤的产物可能需要重新生成。
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => goToStep(progressStep)}
                    className="shrink-0"
                  >
                    回到当前进度
                  </Button>
                </div>
              )}
              {step === 0 && (
                <StepChannel
                  outline={outline}
                  tagIds={tagIds}
                  onOutline={setOutline}
                  onTagIds={setTagIds}
                  seriesId={seriesId}
                  seriesStyleId={seriesStyleId}
                  carryContext={carryContext}
                  castIds={castIds}
                  onSeriesChange={handleSeriesChange}
                  onSeriesStyleChange={setSeriesStyleId}
                  onCarryContextChange={setCarryContext}
                  onCastChange={setCastIds}
                  disabled={starting}
                />
              )}
              {step === 1 && taskId && (
                <StepScript taskId={taskId} task={task ?? null} onStreamingChange={setStreaming} />
              )}
              {step === 2 && taskId && (
                <StepSubjects
                  taskId={taskId}
                  task={task ?? null}
                  onStreamingChange={setStreaming}
                />
              )}
              {step === 3 && taskId && (
                <StepImages
                  taskId={taskId}
                  task={task ?? null}
                  onStreamingChange={setStreaming}
                  onGoToSubjects={() => setStep(2)}
                />
              )}
              {step === 4 && taskId && (
                <StepReview
                  taskId={taskId}
                  task={task ?? null}
                  note={reviewNote}
                  onNote={setReviewNote}
                />
              )}
              {step === 5 && taskId && (
                <StepPublish
                  taskId={taskId}
                  task={task ?? null}
                  publishState={{
                    publishing: pub.publishing,
                    result: pub.result,
                    failure: pub.failure,
                  }}
                />
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
          <Button variant="outline" onClick={goBack} disabled={resuming} className="px-4 py-2">
            {backLabel}
          </Button>
          <div className="flex items-center gap-3">
            {taskInProcess && !resuming && (
              <Button
                variant="destructive"
                onClick={() => void stopGen()}
                disabled={stopping}
                className="px-4 py-2"
              >
                {stopping ? "停止中…" : "停止"}
              </Button>
            )}
            {!resuming && (
              <>
                {step === 0 && (
                  <Button onClick={start} disabled={starting} className="px-5 py-2">
                    {starting ? "创建中…" : "开始"}
                  </Button>
                )}
                {step === 1 && (
                  <Button onClick={goNext} disabled={!step1CanNext} className="px-5 py-2">
                    {step1CanNext ? "确认剧本，下一步" : "等待剧本生成…"}
                  </Button>
                )}
                {step === 2 && (
                  <Button
                    onClick={goNext}
                    disabled={!step2CanNext}
                    title={step2CanNext ? undefined : "请先确认主体"}
                    className="px-5 py-2"
                  >
                    {step2CanNext ? "下一步" : "等待主体确认…"}
                  </Button>
                )}
                {step === 3 && (
                  <Button onClick={goNext} disabled={!step3CanNext} className="px-5 py-2">
                    {step3CanNext ? "下一步" : "等待分格图完成…"}
                  </Button>
                )}
                {step === 4 &&
                  (task?.reviewResult === "pass" ? (
                    <Button onClick={goNext} className="px-5 py-2">
                      下一步
                    </Button>
                  ) : (
                    <Button
                      onClick={() => void passReview()}
                      disabled={reviewing || !step3CanNext}
                      title={step3CanNext ? undefined : "请先完成所有分格图"}
                      className="bg-emerald-600 px-5 py-2 hover:bg-emerald-700"
                    >
                      {reviewing ? "处理中…" : "通过审核"}
                    </Button>
                  ))}
                {step === 5 && (
                  <>
                    <Button
                      onClick={() => void pub.publish()}
                      disabled={pub.publishing || !step3CanNext}
                      className="px-5 py-2"
                    >
                      {pub.publishing ? "发布中…" : pub.result ? "重新发布" : "发布到微信草稿"}
                    </Button>
                    <Button variant="outline" onClick={close} className="px-4 py-2">
                      完成并关闭
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
