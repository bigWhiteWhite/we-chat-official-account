"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { restoreFeedFromEvents } from "@/lib/ai-feed-restore";
import { api, imageSrc, type TaskDetail } from "@/lib/api";
import { useAiStream } from "@/lib/use-ai-stream";

import { AiFeed } from "@/components/ai-feed";
import { PreviewImage } from "@/components/photo-viewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** 步骤 2：剧本创作（AI 流式生成 + 剧本预览 + 对话式修改意见） */
export function StepScript({
  taskId,
  task,
  onStreamingChange,
}: {
  taskId: string;
  task: TaskDetail | null;
  onStreamingChange: (streaming: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const startedRef = useRef(false);
  const modeRef = useRef<"create" | "revise">("create");
  // LLM 提示词回显：流式事件实时捕获 + 任务事件落库兜底（刷新后可再显示）
  const [livePrompt, setLivePrompt] = useState<{ system: string; prompt: string } | null>(null);
  const { items, streaming, start, pushUser, restore } = useAiStream({
    doneLabel: () => (modeRef.current === "revise" ? "剧本修订完成" : "剧本生成完成"),
    onEvent: (ev) => {
      // 拦截 prompt 事件：不进 AI 过程流，单独存下用于回显
      if (ev.type === "prompt") {
        setLivePrompt({ system: String(ev.system ?? ""), prompt: String(ev.prompt ?? "") });
        return true;
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      void queryClient.invalidateQueries({ queryKey: ["events", taskId] });
    },
  });

  const { data: eventsData } = useQuery({
    queryKey: ["events", taskId],
    queryFn: () => api.getEvents(taskId),
    retry: false,
    staleTime: 30_000,
  });
  const persistedPrompt = useMemo(() => {
    const events = eventsData?.events ?? [];
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.eventType !== "llm_prompt" || !ev.payloadJson) continue;
      try {
        const payload = JSON.parse(ev.payloadJson) as { system?: string; prompt?: string };
        if (payload.prompt) return { system: payload.system ?? "", prompt: payload.prompt };
      } catch {
        // 忽略无法解析的事件
      }
    }
    return null;
  }, [eventsData]);
  const promptInfo = livePrompt ?? persistedPrompt;

  // 回看恢复：本步骤最近一次 AI 运行的完整过程（含思考），从任务事件里取回
  const restoredFeed = useMemo(
    () => restoreFeedFromEvents(eventsData?.events, "writing"),
    [eventsData],
  );
  useEffect(() => {
    if (!eventsData || streaming || items.length > 0) return;
    if (restoredFeed.length) restore(restoredFeed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsData]);

  // 同步流式状态到向导（禁用"下一步"按钮）
  useEffect(() => {
    onStreamingChange(streaming);
  }, [streaming, onStreamingChange]);

  function runStream(url: string, body?: unknown, mode?: "create" | "revise") {
    if (mode) modeRef.current = mode;
    void start(url, body);
  }

  // 进入步骤且任务已加载：没有剧本就自动发起生成；
  // 状态已是 writing（如刷新后重入，服务端可能仍在生成）则不重复触发，等待任务轮询刷新
  useEffect(() => {
    if (task === null || startedRef.current) return;
    startedRef.current = true;
    if (!task.script && task.status !== "writing") {
      void runStream(`/api/tasks/${taskId}/generate-script`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task === null]);

  function onRevise() {
    const msg = message.trim();
    if (!msg || streaming || !task?.script) return;
    pushUser(msg);
    setMessage("");
    void runStream(`/api/tasks/${taskId}/revise-script`, { message: msg }, "revise");
  }

  const hasError = items.some((it) => it.type === "error");
  /** 服务端仍在生成剧本（刷新后重入的典型态）：展示续看提示，不重复触发 */
  const serverWriting = !!task && task.status === "writing" && !task.script && !streaming;
  const canRetry =
    (hasError ||
      serverWriting ||
      (["failed", "stopped"].includes(task?.status ?? "") && !task?.script)) &&
    !streaming &&
    !task?.script;
  const liveText = items
    .filter((it) => it.type === "text")
    .map((it) => it.text)
    .join("");

  return (
    <div className="space-y-4">
      {task?.series && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">
              合集《{task.series.name}》{task.episodeNo != null ? `· 第 ${task.episodeNo} 集` : ""}
            </span>
            {task.carryContext && (
              <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-600">
                已带入前情
              </span>
            )}
          </div>
          {task.series.intro && <p className="mt-1 text-xs text-slate-500">{task.series.intro}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {task.series.styleImage && (
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                <PreviewImage
                  src={imageSrc(task.series.styleImage)}
                  alt="画风"
                  className="h-6 w-6 rounded border border-slate-200 object-cover"
                />
                本集画风：{task.series.styleName ?? "—"}
              </span>
            )}
            {task.series.protagonists.map((p) => (
              <span
                key={p.id}
                className="flex items-center gap-1.5 text-xs text-slate-500"
                title={p.imagePrompt || p.name}
              >
                {p.image && (
                  <PreviewImage
                    src={imageSrc(p.image)}
                    alt={p.name}
                    className="h-6 w-6 rounded-full border border-slate-200 object-cover"
                  />
                )}
                {p.name}
              </span>
            ))}
          </div>
          {task.series.recentEpisodes.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
                前情回顾（最近 {task.series.recentEpisodes.length} 集，将注入剧本生成）
              </summary>
              <ul className="mt-1 space-y-1 pl-4">
                {task.series.recentEpisodes.map((e) => (
                  <li key={e.episodeNo} className="list-disc text-xs text-slate-500">
                    第 {e.episodeNo} 集《{e.title || "无标题"}》：{e.digest || "无简介"}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {promptInfo && (
        <details open className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <summary className="cursor-pointer select-none text-xs font-semibold text-slate-500">
            剧本提示词（LLM 实际收到的输入，可对照调整大纲 / 系列设定）
          </summary>
          <div className="mt-2 max-h-60 space-y-2 overflow-y-auto pr-1">
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                System Prompt
              </p>
              <pre className="whitespace-pre-wrap rounded-md bg-white p-2 text-xs leading-relaxed text-slate-600">
                {promptInfo.system}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                User Prompt
              </p>
              <pre className="whitespace-pre-wrap rounded-md bg-white p-2 text-xs leading-relaxed text-slate-600">
                {promptInfo.prompt}
              </pre>
            </div>
          </div>
        </details>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-600">AI 过程</h3>
          <AiFeed items={items} />
          {serverWriting && (
            <p className="mt-2 flex items-center gap-2 text-xs text-blue-600">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
              服务端仍在生成剧本（刷新后自动续看），长时间无变化可点下方「重试本步骤」。
            </p>
          )}
          {canRetry && (
            <Button
              variant="outline"
              onClick={() => void runStream(`/api/tasks/${taskId}/generate-script`)}
              className="mt-2 border-red-300 bg-red-50 px-3 py-1.5 text-red-600 hover:bg-red-100 hover:text-red-600"
            >
              重试本步骤
            </Button>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-600">剧本预览</h3>
          {task?.script ? (
            <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
              <p className="font-medium text-slate-800">
                {task.script.title}
                {task.script.punchline && (
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    爆点：{task.script.punchline}
                  </span>
                )}
              </p>
              <div className="max-h-[320px] space-y-2 overflow-y-auto">
                {task.script.panels.map((p, i) => (
                  <div key={i} className="rounded-md bg-white p-2 text-sm">
                    <p className="text-xs text-slate-400">
                      第 {i + 1} 格 · {p.character}
                    </p>
                    <p className="mt-1 text-slate-700">{p.scene}</p>
                    <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-slate-900">
                      「{p.dialogue}」
                    </p>
                    {p.narration && p.narration.trim() !== "无" && (
                      <p className="mt-1 text-xs leading-5 text-slate-500">旁白：{p.narration}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : streaming && liveText ? (
            <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
              <p className="flex items-center gap-2 text-xs text-slate-400">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                实时输出（流式）
              </p>
              <pre className="max-h-[320px] overflow-y-auto whitespace-pre-wrap text-sm text-slate-700">
                {liveText}
              </pre>
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-400">
              {streaming || serverWriting ? "剧本生成中…" : "暂无剧本"}
            </div>
          )}

          <div className="mt-3">
            <Label htmlFor="revise-msg" className="mb-1.5 text-sm font-medium text-slate-700">
              修改意见（可选）
            </Label>
            <div className="flex gap-2">
              <Input
                id="revise-msg"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onRevise();
                }}
                disabled={streaming || !task?.script}
                placeholder={
                  task?.script ? "例如：第 3 格台词太长了，爆点再夸张一点" : "剧本生成后可编辑"
                }
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={onRevise}
                disabled={streaming || !task?.script || !message.trim()}
                className="px-4 py-2"
              >
                发送
              </Button>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {streaming ? "AI 正在输出，请稍候…" : "发送后 AI 会基于意见重写整份剧本"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
