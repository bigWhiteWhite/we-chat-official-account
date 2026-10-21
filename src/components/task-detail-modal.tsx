"use client";

import { Button } from "@/components/ui/button";
import { TaskDetail } from "@/components/task-detail";
import { useUiStore } from "@/store/ui";

/** 任务详情弹窗：列表「查看详情」打开，复用 TaskDetail（embedded 模式） */
export function TaskDetailModal() {
  const detailTaskId = useUiStore((s) => s.detailTaskId);
  const closeDetail = useUiStore((s) => s.closeDetail);

  if (!detailTaskId) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-slate-900/40 p-4"
      onClick={closeDetail}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-3">
          <h2 className="text-lg font-semibold">任务详情</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={closeDetail}
            aria-label="关闭"
            className="px-2 py-1 text-slate-400 hover:text-slate-600"
          >
            ✕
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto bg-slate-50">
          <TaskDetail taskId={detailTaskId} embedded />
        </div>
      </div>
    </div>
  );
}
