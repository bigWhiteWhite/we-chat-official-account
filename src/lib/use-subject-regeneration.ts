"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { bustImageCache } from "@/lib/api";
import { streamPost } from "@/lib/sse";
import type { SseEvent } from "@/lib/use-ai-stream";

export type SubjectKind = "character" | "style";

/**
 * 单主体生成/重生成（SSE）：pending 状态 + 成功提示 + 任务刷新。
 * 主体确认页与分格生成页共用；onSubject 用于把生成结果写入调用方的本地预览。
 */
export function useSubjectRegeneration(
  taskId: string,
  opts?: { preset?: string; onSubject?: (ev: SseEvent) => void },
) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const keyOf = (kind: SubjectKind, index?: number) =>
    kind + (index !== undefined ? `-${index}` : "");

  const isPending = useCallback(
    (kind: SubjectKind, index?: number) => !!pending[keyOf(kind, index)],
    [pending],
  );

  const regenerate = useCallback(
    async (kind: SubjectKind, index?: number) => {
      const key = keyOf(kind, index);
      setPending((prev) => ({ ...prev, [key]: true }));
      try {
        await streamPost(
          `/api/tasks/${taskId}/subject-image`,
          { kind, index, ...(opts?.preset ? { preset: opts.preset } : {}) },
          (ev) => {
            if (ev.type === "subject") opts?.onSubject?.(ev);
          },
          new AbortController().signal,
        );
        toast.success("主体已重新生成");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "重新生成失败");
      } finally {
        setPending((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        // 主体图按原路径覆盖写入，递增版本号避免浏览器展示旧图
        bustImageCache();
        void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      }
    },
    [taskId, opts?.preset, opts?.onSubject],
  );

  return { regenerate, isPending };
}
