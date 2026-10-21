import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CSSProperties, useRef, useState } from "react";
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
import { toast } from "sonner";

import { useUiStore } from "@/store/ui";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PreviewGroup, PreviewImage } from "@/components/photo-viewer";
import { ImageActionOverlay } from "@/components/workflow/image-action-overlay";
import { ImageGenMask } from "@/components/workflow/image-gen-mask";
import { PanelPromptModal } from "@/components/workflow/panel-prompt-modal";
import { PanelVersionDialog } from "@/components/workflow/panel-version-dialog";
import {
  SaveAssetModal,
  buildSavePrefill,
  type SaveTarget,
} from "@/components/workflow/save-asset-modal";
import { SubjectCard } from "@/components/workflow/subject-card";
import {
  SubjectPromptModal,
  type SubjectPromptTarget,
} from "@/components/workflow/subject-prompt-modal";
import {
  api,
  bustImageCache,
  imageSrc,
  isTaskReferences,
  type ComicPanelRow,
  type TaskDetail,
} from "@/lib/api";
import { makeReorder } from "@/lib/optimistic-reorder";
import { streamPost } from "@/lib/sse";
import { useSubjectRegeneration } from "@/lib/use-subject-regeneration";

function isSafetyError(message?: string) {
  return !!message && (message.includes("400") || message.includes("安全"));
}

/** 可拖拽排序的分格格口：拖手柄调序，剧本与图片路径由后端同步重排 */
function SortablePanelCell({
  index,
  img,
  isPending,
  cellBusy,
  busyLabel,
  err,
  safety,
  canDrag,
  locked,
  onRegenerate,
  onEdit,
  onDelete,
  onVersions,
}: {
  index: number;
  img: string | null;
  isPending: boolean;
  cellBusy: boolean;
  busyLabel: string;
  err?: string;
  safety: boolean;
  canDrag: boolean;
  /** 批量生成/服务端在途时锁定单格操作，防止按下标写图错位 */
  locked: boolean;
  onRegenerate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** 打开版本选择弹窗（仅已有图的格显示） */
  onVersions?: () => void;
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
      <div className="relative flex aspect-square items-center justify-center bg-slate-50">
        {img ? (
          <PreviewImage
            src={imageSrc(img)}
            alt={`第 ${index + 1} 格`}
            className="h-full w-full object-cover"
          />
        ) : err ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3">
            <p className="line-clamp-3 text-center text-xs text-red-500">
              {safety
                ? "该格提示词被安全策略拦截，无法直接生成。可修改提示词后重试，或删除该格。"
                : err}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {safety && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onEdit}>
                  修改提示词
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                onClick={onRegenerate}
                disabled={isPending || locked}
              >
                重试
              </Button>
              <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={onDelete}>
                删除
              </Button>
            </div>
          </div>
        ) : (
          <span className="text-xs text-slate-400">未生成</span>
        )}
        {cellBusy && <ImageGenMask label={busyLabel} />}
      </div>
      {!err && (
        <ImageActionOverlay
          direction="row"
          actions={[
            {
              key: "regen",
              label: img ? "重新生成" : "生成此格",
              onClick: onRegenerate,
              disabled: isPending || locked,
            },
            { key: "edit", label: img ? "修改提示词" : "查看提示词", onClick: onEdit },
            ...(img && onVersions
              ? [
                  {
                    key: "versions",
                    label: "版本",
                    onClick: onVersions,
                    disabled: isPending || locked,
                  },
                ]
              : []),
            { key: "delete", label: "删除", onClick: onDelete, variant: "destructive" },
          ]}
        />
      )}
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
      <span className="absolute bottom-1 left-1.5 rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-white">
        第 {index + 1} 格
      </span>
    </div>
  );
}

/** 安全中止：忽略已中止/已关闭的 controller，避免抛出 "Controller is already closed" */
function abortSafely(controller: AbortController | null | undefined) {
  if (!controller || controller.signal.aborted) return;
  try {
    controller.abort();
  } catch {
    // controller 可能已随请求结束而关闭，忽略即可
  }
}

/** 步骤 4：漫画生成（顶部主体参考卡：可重新生成/存为资产；分格图按格取参考，可重生成/改提示词/删除/拖拽排序） */
export function StepImages({
  taskId,
  task,
  onStreamingChange,
  onGoToSubjects,
}: {
  taskId: string;
  task: TaskDetail | null;
  onStreamingChange: (streaming: boolean) => void;
  onGoToSubjects: () => void;
}) {
  const queryClient = useQueryClient();
  const [genActive, setGenActive] = useState(false);
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [pending, setPending] = useState<Set<number>>(new Set());
  const [panelErrors, setPanelErrors] = useState<Record<number, string>>({});
  const [saveTarget, setSaveTarget] = useState<SaveTarget | null>(null);
  const [editPanel, setEditPanel] = useState<number | null>(null);
  const [promptTarget, setPromptTarget] = useState<SubjectPromptTarget | null>(null);
  const [reorderingPanels, setReorderingPanels] = useState(false);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [versionPanel, setVersionPanel] = useState<number | null>(null);
  const layout = useUiStore((s) => s.comicLayout);
  const setLayout = useUiStore((s) => s.setComicLayout);
  const abortRef = useRef<AbortController | null>(null);

  const panelSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const panels = task?.script?.panels ?? [];
  const images: (string | null)[] = task?.images ?? [];
  const refsNew = task && isTaskReferences(task.references) ? task.references : null;
  const refsLegacy =
    !refsNew && task?.references ? (task.references as Record<string, string>) : null;
  const hasRefs = !!(refsNew || refsLegacy);

  const doneCount = images.filter(Boolean).length;
  const allDone = panels.length > 0 && images.length === panels.length && images.every(Boolean);
  // 服务端在途的单格（刷新后仍有效）与本地在途合并为“忙碌格”，多格可并行生成
  const serverPanels = new Set((task?.generatingPanels ?? []).map(Number));
  const busyPanels = new Set<number>([...pending, ...serverPanels]);

  const { data: assetsData } = useQuery({
    queryKey: ["assets", "all-for-subjects"],
    queryFn: () => api.getAssets(),
    retry: false,
  });
  const assets = assetsData?.assets ?? [];
  const savePrefill = (kind: "character", name: string, assetId: string | null) =>
    buildSavePrefill({
      kind,
      name,
      preset: refsNew?.style?.preset ?? null,
      asset: assetId ? (assets.find((a) => a.id === assetId) ?? null) : null,
    });
  // 刷新后重入、服务端仍在生成：task.generating 表示服务端 run 在途（逐格落库，生成一张显示一张）；
  // run 结束后 generating 变 false（全成→reviewing / 部分失败停留 drawing），允许对失败格重试
  const serverDrawing = !!task && task.status === "drawing" && !genActive && !!task.generating;

  const refreshTask = () => void queryClient.invalidateQueries({ queryKey: ["task", taskId] });

  // 主体参考图生成/重生成（与主体确认页共用同一 hook）
  const { regenerate: regenerateSubject, isPending: subjectPending } =
    useSubjectRegeneration(taskId);
  /** 有提示词才给"查看提示词"入口（绑定资产的主体不单独生成，无对应提示词） */
  const viewPrompt = (
    target: Omit<SubjectPromptTarget, "prompt">,
    prompt: string | null | undefined,
  ) => (prompt ? () => setPromptTarget({ ...target, prompt }) : undefined);

  // 关闭弹窗不中断生成：服务端 run 会继续执行并逐格落库，重开任务即可续看；
  // 也避免卸载时 abort 已结束/已关闭的 controller 触发 "Controller is already closed"。

  async function runGenerateAll() {
    abortSafely(abortRef.current);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setGenActive(true);
    onStreamingChange(true);
    setGenProgress({ done: 0, total: panels.length });
    setPanelErrors({});
    try {
      await streamPost(
        `/api/tasks/${taskId}/generate-images`,
        { layout },
        (ev) => {
          if (ev.type === "panel" || ev.type === "panel-error") {
            setGenProgress((p) => ({ ...p, done: p.done + 1 }));
            if (ev.type === "panel-error") {
              const i = Number(ev.index);
              setPanelErrors((prev) => ({ ...prev, [i]: String(ev.message ?? "生成失败") }));
            }
            refreshTask();
          }
        },
        ctrl.signal,
      );
    } catch (err) {
      const e = err as Error;
      if (e.name !== "AbortError") {
        toast.error(e.message || "分格图生成失败");
      }
    } finally {
      setGenActive(false);
      onStreamingChange(false);
      // 分格图按原路径覆盖写入，递增版本号让已显示的旧图立即刷新
      bustImageCache();
      refreshTask();
    }
  }

  async function regeneratePanel(index: number) {
    if (busyPanels.has(index) || genActive || serverDrawing) return;
    setPending((prev) => new Set(prev).add(index));
    setPanelErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    try {
      const res = await api.regeneratePanel(taskId, index, layout);
      bustImageCache(res.path);
      toast.success(`第 ${index + 1} 格已生成`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "重新生成失败";
      setPanelErrors((prev) => ({ ...prev, [index]: msg }));
      toast.error(msg);
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
      refreshTask();
    }
  }

  function requestDeletePanel(index: number) {
    setDeleteIndex(index);
  }

  async function confirmDeletePanel() {
    if (deleteIndex === null) return;
    setDeleting(true);
    try {
      await api.deletePanel(taskId, deleteIndex);
      toast.success(`第 ${deleteIndex + 1} 格已删除`);
      refreshTask();
      setDeleteIndex(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  /** 生成 / 重生成 / 删格进行期间禁止拖拽，避免服务端按下标写图时错位 */
  const dragDisabled = genActive || serverDrawing || busyPanels.size > 0 || reorderingPanels;

  const reorderPanels = makeReorder<ComicPanelRow, TaskDetail>(queryClient, {
    queryKey: ["task", taskId],
    getItems: (d) => d.script?.panels ?? [],
    apply: (d, next, fromIdx, toIdx) => {
      const images = d.images ?? [];
      const panelsLen = d.script?.panels?.length ?? 0;
      return {
        ...d,
        script: d.script ? { ...d.script, panels: next } : d.script,
        images: images.length === panelsLen ? arrayMove(images, fromIdx, toIdx) : images,
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

  if (!hasRefs) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <p className="text-sm text-slate-500">请先在上一步确认主体</p>
        <Button onClick={onGoToSubjects}>返回主体确认</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-600">主体参考（生图唯一参考源）</h3>
        {refsNew ? (
          <div className="space-y-3">
            {refsNew.style && (
              <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <span className="shrink-0 text-xs font-medium text-slate-500">画风</span>
                {refsNew.style.image && (
                  <PreviewImage
                    src={imageSrc(refsNew.style.image)}
                    alt="画风"
                    className="h-10 w-10 rounded object-cover"
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                  {refsNew.style.preset || "默认画风"}
                </span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                  {refsNew.style.assetId ? "库资产" : "默认"}
                </span>
              </div>
            )}
            <div className="flex flex-wrap items-start gap-3">
              {/* 主场景不再单独文生图：仅绑定场景资产时展示参考卡 */}
              {refsNew.scene.image && (
                <SubjectCard
                  kind="scene"
                  name={refsNew.scene.name}
                  image={refsNew.scene.image}
                  source={refsNew.scene.assetId ? "asset" : "generated"}
                />
              )}
              {refsNew.characters.map((c, i) => (
                <SubjectCard
                  key={i}
                  kind="character"
                  name={c.name}
                  image={c.image}
                  source={c.assetId ? "asset" : "generated"}
                  index={i}
                  regenerating={subjectPending("character", i)}
                  onRegenerate={
                    c.assetId ? undefined : () => void regenerateSubject("character", i)
                  }
                  onViewPrompt={viewPrompt(
                    {
                      kind: "character",
                      index: i,
                      name: c.name,
                      title: `角色「${c.name}」提示词`,
                    },
                    task?.subjectPrompts?.characters[i],
                  )}
                  onSave={
                    c.image
                      ? () =>
                          setSaveTarget({
                            type: "character",
                            name: c.name,
                            image: c.image!,
                            key: `char-${i}`,
                            stylePreset: refsNew?.style?.preset ?? null,
                            ...savePrefill("character", c.name, c.assetId),
                          })
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            {(["character", "scene"] as const).map((slot) => {
              const p = refsLegacy![slot];
              return (
                <div
                  key={slot}
                  className="flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white"
                >
                  <div className="flex aspect-square items-center justify-center bg-slate-50">
                    {p ? (
                      <PreviewImage
                        src={imageSrc(p)}
                        alt={slot}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-slate-400">无参考图</span>
                    )}
                  </div>
                  <p className="px-3 py-1.5 text-xs text-slate-500">
                    {slot === "character" ? "角色参考" : "场景参考"}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {serverDrawing && (
        <p className="flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-600">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
          服务端仍在生成分格图（刷新后自动续看，已生成的格子会实时显示）；长时间无变化可点底部「停止」后重新生成。
        </p>
      )}
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500">布局：</span>
        <ToggleGroup
          type="single"
          value={layout}
          onValueChange={(v) => v && setLayout(v as "wide" | "tall")}
          spacing={0}
        >
          <ToggleGroupItem
            value="wide"
            className="px-3 py-1 text-xs data-[state=on]:bg-primary data-[state=on]:text-white"
          >
            横版
          </ToggleGroupItem>
          <ToggleGroupItem
            value="tall"
            className="px-3 py-1 text-xs data-[state=on]:bg-primary data-[state=on]:text-white"
          >
            竖版
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex items-center justify-between">
        <Button
          onClick={() => void runGenerateAll()}
          disabled={!hasRefs || genActive || serverDrawing || allDone || busyPanels.size > 0}
        >
          {genActive
            ? `生成中 ${genProgress.done}/${genProgress.total}…`
            : serverDrawing
              ? "生成中（服务端）…"
              : allDone
                ? "分格图已全部生成"
                : "生成分格图"}
        </Button>
        <span className="text-xs text-slate-400">
          {hasRefs ? `已生成 ${doneCount}/${panels.length} 格` : "等待参考图就绪"}
        </span>
      </div>

      {panels.length > 0 && (
        <DndContext
          sensors={panelSensors}
          collisionDetection={closestCenter}
          onDragEnd={(e) => void handlePanelsDragEnd(e)}
        >
          <PreviewGroup>
            <SortableContext items={panels.map((_, i) => i)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {panels.map((_, i) => {
                  const img = images[i] ?? null;
                  const isPending = busyPanels.has(i);
                  // 进度遮罩：已有图 = 该格重新生成中；无图 = 整批生成中（含刷新后续看）
                  const cellBusy = img ? isPending : genActive || isPending || serverDrawing;
                  const err = panelErrors[i];
                  return (
                    <SortablePanelCell
                      key={i}
                      index={i}
                      img={img}
                      isPending={isPending}
                      cellBusy={cellBusy}
                      busyLabel={
                        img
                          ? "重新生成中…"
                          : genActive
                            ? `生成中 ${genProgress.done}/${genProgress.total}`
                            : "生成中…"
                      }
                      err={err}
                      safety={isSafetyError(err)}
                      canDrag={panels.length > 1 && !dragDisabled}
                      locked={genActive || serverDrawing}
                      onRegenerate={() => void regeneratePanel(i)}
                      onEdit={() => setEditPanel(i)}
                      onDelete={() => requestDeletePanel(i)}
                      onVersions={img ? () => setVersionPanel(i) : undefined}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </PreviewGroup>
        </DndContext>
      )}

      {saveTarget && (
        <SaveAssetModal
          target={saveTarget}
          sourceTaskId={taskId}
          defaultSeriesId={task?.seriesId}
          onClose={() => setSaveTarget(null)}
        />
      )}

      {editPanel !== null && task?.script && (
        <PanelPromptModal
          taskId={taskId}
          script={task.script}
          index={editPanel}
          fullPrompt={task.panelPrompts?.[editPanel]}
          stylePreset={refsNew?.style?.preset ?? task.stylePreset}
          narrationInImage={task.narrationInImage}
          layout={layout}
          onClose={() => setEditPanel(null)}
          onSaved={() => void regeneratePanel(editPanel)}
        />
      )}

      {promptTarget && (
        <SubjectPromptModal
          taskId={taskId}
          target={promptTarget}
          onClose={() => setPromptTarget(null)}
          onRegenerate={() => regenerateSubject(promptTarget.kind, promptTarget.index)}
        />
      )}

      {versionPanel !== null && (
        <PanelVersionDialog
          taskId={taskId}
          index={versionPanel}
          onClose={() => setVersionPanel(null)}
        />
      )}

      <AlertDialog
        open={deleteIndex !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteIndex(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除分镜</AlertDialogTitle>
            <AlertDialogDescription>
              删除第 {(deleteIndex ?? 0) + 1} 格？剧本与图片将同步删除，此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void confirmDeletePanel();
              }}
            >
              {deleting ? "删除中…" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
