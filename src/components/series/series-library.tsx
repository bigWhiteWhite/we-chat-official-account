"use client";

import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Layers, Plus } from "lucide-react";
import { toast } from "sonner";

import { PreviewImage } from "@/components/photo-viewer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api, imageSrc, type SeriesSummary } from "@/lib/api";
import { SeriesFormDialog } from "./series-form-dialog";
import { makeReorder } from "@/lib/optimistic-reorder";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  ongoing: { label: "连载中", className: "bg-emerald-100 text-emerald-700" },
  finished: { label: "已完结", className: "bg-slate-200 text-slate-500" },
};

/** 可拖拽排序的合集卡片：拖拽换序后调用 reorderSeries 持久化 */
function SeriesCard({
  series,
  onOpen,
  onEdit,
  onToggleFinish,
  onDelete,
}: {
  series: SeriesSummary;
  onOpen: (s: SeriesSummary) => void;
  onEdit: (s: SeriesSummary) => void;
  onToggleFinish: (s: SeriesSummary) => void;
  onDelete: (s: SeriesSummary) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: series.id,
  });
  const status = STATUS_LABEL[series.status] ?? STATUS_LABEL.ongoing;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group cursor-pointer rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md ${
        isDragging ? "z-10 opacity-90 shadow-lg ring-2 ring-blue-400" : ""
      }`}
      onClick={() => onOpen(series)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="shrink-0 cursor-grab rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing"
            aria-label={`拖动排序 ${series.name}`}
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          {(series.coverPath || series.styleImage) && (
            <PreviewImage
              src={imageSrc(series.coverPath ?? series.styleImage!)}
              alt={series.name}
              className="h-10 w-10 rounded-md border border-slate-200 object-cover"
            />
          )}
          <div>
            <p className="truncate font-medium text-slate-900">{series.name}</p>
            <p className="text-xs text-slate-400">
              {series.episodeCount} 集 · {series.styles.map((s) => s.name).join("、") || "未设画风"}
            </p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${status.className}`}>
          {status.label}
        </span>
      </div>

      {series.intro && <p className="mt-2 line-clamp-2 text-xs text-slate-500">{series.intro}</p>}

      <div className="mt-3 flex items-center justify-between">
        <div className="flex -space-x-1.5">
          {series.protagonists
            .slice(0, 4)
            .map((p) =>
              p.image ? (
                <PreviewImage
                  key={p.id}
                  src={imageSrc(p.image)}
                  alt={p.name}
                  className="h-7 w-7 rounded-full border-2 border-white object-cover"
                />
              ) : null,
            )}
          {series.protagonists.length > 4 && (
            <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-[10px] text-slate-500">
              +{series.protagonists.length - 4}
            </span>
          )}
        </div>
        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(series);
            }}
          >
            编辑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFinish(series);
            }}
          >
            {series.status === "ongoing" ? "完结" : "恢复"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-red-500 hover:text-red-600"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(series);
            }}
          >
            删除
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 合集列表页：卡片展示 + 拖拽排序 + 新建/删除入口 */
export function SeriesLibrary() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [formSeriesId, setFormSeriesId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SeriesSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reordering, setReordering] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const { data, isLoading } = useQuery({
    queryKey: ["series"],
    queryFn: () => api.getSeries(),
    retry: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["series"] });

  const toggleFinish = async (s: SeriesSummary) => {
    try {
      await api.updateSeries(s.id, { status: s.status === "ongoing" ? "finished" : "ongoing" });
      toast.success(s.status === "ongoing" ? "已标记完结" : "已恢复连载");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteSeries(deleteTarget.id);
      toast.success("合集已删除，其剧集保留在任务列表");
      setDeleteTarget(null);
      refresh();
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const reorderSeries = makeReorder<SeriesSummary, { series: SeriesSummary[] }>(queryClient, {
    queryKey: ["series"],
    getItems: (d) => d.series,
    apply: (d, next) => ({ ...d, series: next }),
    idOf: (s) => s.id,
    persist: ({ order }) => api.reorderSeries(order),
    successMsg: "合集顺序已更新",
    onStart: () => setReordering(true),
    onFinish: (ok) => {
      setReordering(false);
      if (ok) refresh();
    },
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    void reorderSeries(String(active.id), String(over.id));
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">合集</h1>
          <p className="mt-1 text-sm text-slate-500">
            固定主角与画风（可多个），逐集连载创作；剧集创建时选择本集画风；剧集发布后自动沉淀本集简介，供后续剧集参考
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)} className="px-4">
          <Plus className="h-4 w-4" />
          新建合集
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : (data?.series.length ?? 0) === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <Layers className="mb-3 h-8 w-8 text-slate-300" />
          <p className="text-sm text-slate-500">
            还没有合集。创建合集后，可固定主角与多个画风，逐集连载创作漫画。
          </p>
          <Button className="mt-4" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" />
            新建合集
          </Button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(e) => void handleDragEnd(e)}
        >
          <SortableContext items={data!.series.map((s) => s.id)} strategy={rectSortingStrategy}>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {data!.series.map((s) => (
                <SeriesCard
                  key={s.id}
                  series={s}
                  onOpen={(ser) => (window.location.href = `/series/${ser.id}`)}
                  onEdit={(ser) => {
                    setFormSeriesId(ser.id);
                    setFormOpen(true);
                  }}
                  onToggleFinish={(ser) => void toggleFinish(ser)}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {reordering && <p className="mt-2 text-right text-xs text-slate-400">正在保存合集顺序…</p>}

      <SeriesFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        series={formSeriesId ? (data?.series.find((s) => s.id === formSeriesId) ?? null) : null}
        onSaved={(s) => {
          refresh();
          if (!formSeriesId) {
            window.location.href = `/series/${s.id}`;
          }
        }}
      />

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除合集</DialogTitle>
            <DialogDescription>
              确定删除合集「{deleteTarget?.name}」？已有 {deleteTarget?.episodeCount ?? 0}{" "}
              集任务将保留在任务列表中（不再关联合集）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? "删除中…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
