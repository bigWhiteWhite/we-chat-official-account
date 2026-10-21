"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { api, formatTime, type TaskDetail, type PublishResult } from "@/lib/api";
import { SOURCE_LABELS } from "@/lib/status";
import type { PublishFailure } from "./use-publish";

export type PublishState = {
  publishing: boolean;
  result: PublishResult | null;
  failure: PublishFailure | null;
};

/** 步骤 5：发布到微信草稿箱。展示微信原始反馈（errcode/errmsg）与事件日志；「发布/完成」按钮在弹窗底部。 */
export function StepPublish({
  taskId,
  task,
  publishState,
}: {
  taskId: string;
  task: TaskDetail | null;
  publishState: PublishState;
}) {
  const { publishing, result, failure } = publishState;
  const [showLogs, setShowLogs] = useState(false);

  const { data: eventsData } = useQuery({
    queryKey: ["events", taskId],
    queryFn: () => api.getEvents(taskId),
    enabled: showLogs,
    refetchInterval: showLogs ? 2000 : false,
  });

  const events = eventsData?.events ?? [];

  return (
    <div className="space-y-5">
      {task?.script && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
          <h3 className="text-base font-semibold text-slate-800">{task.script.title}</h3>
          <p className="mt-1 text-xs text-slate-500">
            来源：{SOURCE_LABELS[task.sourceType] ?? task.sourceType}
            {task.draftMediaId ? ` · 已有草稿：${task.draftMediaId}` : " · 尚未创建草稿"}
          </p>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm leading-6 text-slate-600">
        发布将上传封面与正文图到微信素材库并创建草稿。自动化终点是
        <b>草稿箱</b>，正式发布需到公众号后台人工操作。
      </div>

      {result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="font-medium text-emerald-700">✓ 草稿创建成功</p>
          <p className="mt-1 text-sm text-emerald-700">
            draft_media_id：<span className="font-mono">{result.draftMediaId}</span>
          </p>
          <p className="mt-1 text-xs text-emerald-600">
            微信反馈：errcode {result.feedback.errcode} · {result.feedback.errmsg}
          </p>
        </div>
      )}

      {failure && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="font-medium text-red-700">✕ 发布失败</p>
          <p className="mt-1 break-words text-sm text-red-700">{failure.error}</p>
          {failure.errcode !== undefined && (
            <p className="mt-1 text-xs text-red-600">
              微信反馈：errcode {failure.errcode} · {failure.errmsg ?? ""}
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            部分错误（如凭证、频次限制）需到公众号后台处理；可重试或查看日志定位。
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => setShowLogs((s) => !s)}
          disabled={publishing}
          className="px-4 py-2"
        >
          {showLogs ? "隐藏日志" : "查看日志"}
        </Button>
      </div>

      {showLogs && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            执行日志（每 2 秒自动刷新）
          </p>
          {events.length === 0 ? (
            <p className="py-3 text-center text-sm text-slate-400">暂无日志</p>
          ) : (
            <ol className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {events.map((e) => (
                <li key={e.id} className="flex items-start gap-2 text-sm">
                  <Badge variant="secondary" className="mt-0.5 w-14 shrink-0 px-1.5 py-0.5 text-xs">
                    {e.stage}
                  </Badge>
                  <span className="w-28 shrink-0 text-xs text-slate-400">
                    {formatTime(e.createdAt)}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-slate-500">{e.eventType}</span>
                  <span className="min-w-0 break-all text-slate-700">{e.message}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
