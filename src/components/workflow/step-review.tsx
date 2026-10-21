"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { CSSProperties, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PreviewGroup, PreviewImage } from "@/components/photo-viewer";
import { api, imageSrc, type ComicPanelRow, type TaskDetail } from "@/lib/api";
import { makeReorder } from "@/lib/optimistic-reorder";
import { SOURCE_LABELS } from "@/lib/status";

/** 可拖拽的审核格口：拖手柄调整格序，剧本与图片路径由后端同步重排 */
function SortableReviewCell({
  index,
  panel,
  img,
  canDrag,
}: {
  index: number;
  panel: ComicPanelRow;
  img: string | null;
  canDrag: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: index, disabled: !canDrag });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 ${
        isDragging ? "z-10 opacity-90 shadow-lg ring-2 ring-blue-400" : ""
      }`}
    >
      <div className="flex aspect-square items-center justify-center bg-white">
        {img ? (
          <PreviewImage
            src={imageSrc(img)}
            alt={`第 ${index + 1} 格`}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-xs text-red-400">第 {index + 1} 格缺失</span>
        )}
      </div>
      <div className="px-2 py-1.5 text-xs text-slate-500">
        <p className="line-clamp-1">
          第 {index + 1} 格 · {panel.character}
        </p>
        <p className="mt-0.5 line-clamp-2">「{panel.dialogue}」</p>
        {panel.narration && panel.narration.trim() !== "无" ? (
          <p className="mt-0.5 line-clamp-5 text-slate-400">{panel.narration}</p>
        ) : null}
      </div>
      {canDrag && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`拖拽调整第 ${index + 1} 格顺序`}
          title="拖拽调整格序"
          className="absolute right-1 top-1 z-10 flex h-6 w-6 cursor-grab items-center justify-center rounded bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** 步骤 4：人工审核。整稿预览 + 拖拽调序 + 审核备注；「通过审核」动作在弹窗底部按钮。 */
export function StepReview({
  taskId,
  task,
  note,
  onNote,
}: {
  taskId: string;
  task: TaskDetail | null;
  note: string;
  onNote: (note: string) => void;
}) {
  const queryClient = useQueryClient();
  const [reorderingPanels, setReorderingPanels] = useState(false);
  const panelSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const panels = task?.script?.panels ?? [];
  const images: (string | null)[] = task?.images ?? [];
  const doneCount = images.filter(Boolean).length;
  const missing = panels.length - doneCount;
  // 全部图片生成完才允许拖拽，避免服务端按下标写图时图文错位
  const canDrag = panels.length > 1 && missing === 0 && !reorderingPanels;

  const reorderPanels = makeReorder<ComicPanelRow, TaskDetail>(queryClient, {
    queryKey: ["task", taskId],
    getItems: (d) => d.script?.panels ?? [],
    apply: (d, next, fromIdx, toIdx) => {
      const imgs = d.images ?? [];
      const panelsLen = d.script?.panels?.length ?? 0;
      return {
        ...d,
        script: d.script ? { ...d.script, panels: next } : d.script,
        images: imgs.length === panelsLen ? arrayMove(imgs, fromIdx, toIdx) : imgs,
      };
    },
    idOf: (_p, i) => String(i),
    persist: ({ fromIdx, toIdx }) => api.reorderPanels(taskId, fromIdx, toIdx),
    successMsg: "格序已更新",
    onStart: () => setReorderingPanels(true),
    onFinish: () => setReorderingPanels(false),
  });

  function handlePanelsDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    void reorderPanels(String(active.id), String(over.id));
  }

  if (!task) {
    return <p className="py-10 text-center text-sm text-slate-400">加载中…</p>;
  }

  return (
    <div className="space-y-5">
      {task.script && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
          <h3 className="text-base font-semibold text-slate-800">{task.script.title}</h3>
          <p className="mt-1 text-xs text-slate-500">
            来源：{SOURCE_LABELS[task.sourceType] ?? task.sourceType}
            {task.script.punchline ? ` · 爆点：${task.script.punchline}` : ""}
          </p>
          {task.script.intro ? (
            <p className="mt-2 rounded-md border border-slate-200/70 bg-white px-2.5 py-2 text-xs leading-relaxed text-slate-600">
              <span className="mr-1.5 font-medium text-slate-500">导语</span>
              {task.script.intro}
            </p>
          ) : null}
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-600">
            整稿预览（{panels.length} 格，已完成 {doneCount} 格）
          </h3>
          {missing > 0 ? (
            <Badge variant="secondary" className="bg-amber-100 text-amber-700">
              还有 {missing} 格未生成，请先返回完成生图
            </Badge>
          ) : task.reviewResult === "pass" ? (
            <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
              已通过审核
            </Badge>
          ) : canDrag ? (
            <Badge variant="secondary" className="bg-slate-100 text-slate-500">
              拖拽右上角手柄调整格序
            </Badge>
          ) : null}
        </div>
        {panels.length === 0 ? (
          <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-400">
            暂无剧本
          </div>
        ) : (
          <DndContext
            sensors={panelSensors}
            collisionDetection={closestCenter}
            onDragEnd={(e) => void handlePanelsDragEnd(e)}
          >
            <PreviewGroup>
              <SortableContext items={panels.map((_, i) => i)} strategy={rectSortingStrategy}>
                <div className="grid max-h-[420px] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
                  {panels.map((p, i) => (
                    <SortableReviewCell
                      key={i}
                      index={i}
                      panel={p}
                      img={images[i] ?? null}
                      canDrag={canDrag}
                    />
                  ))}
                </div>
              </SortableContext>
            </PreviewGroup>
          </DndContext>
        )}
      </div>

      <div>
        <Label htmlFor="review-note" className="mb-1.5 text-sm font-medium text-slate-700">
          审核备注（可选）
        </Label>
        <Input
          id="review-note"
          value={note}
          onChange={(e) => onNote(e.target.value)}
          placeholder="例如：整体节奏可以，第 4 格表情再夸张一点"
        />
      </div>
    </div>
  );
}
