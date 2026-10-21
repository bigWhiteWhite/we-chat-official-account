"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronRight,
  FolderClosed,
  GripVertical,
  Layers,
  LayoutGrid,
  List,
} from "lucide-react";
import { toast } from "sonner";

import { AssetEditor } from "./asset-editor";
import { AssetExtend } from "./asset-extend";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PreviewImage } from "@/components/photo-viewer";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  api,
  formatTime,
  imageSrc,
  type AssetSummary,
  type AssetType,
  type SeriesSummary,
} from "@/lib/api";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { getPageItems } from "@/lib/pagination";
import { makeReorder } from "@/lib/optimistic-reorder";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

const TYPE_TABS: Array<{ key: AssetType; label: string }> = [
  { key: "character", label: "角色" },
  { key: "scene", label: "场景" },
  { key: "style", label: "画风" },
];

const TYPE_BADGE: Record<AssetType, { label: string; className: string }> = {
  character: { label: "角色", className: "bg-indigo-100 text-indigo-700" },
  scene: { label: "场景", className: "bg-emerald-100 text-emerald-700" },
  style: { label: "画风", className: "bg-amber-100 text-amber-700" },
};

const ROLE_BADGE: Record<string, { label: string; className: string }> = {
  protagonist: { label: "主角", className: "bg-indigo-100 text-indigo-700" },
  scene: { label: "场景", className: "bg-emerald-100 text-emerald-700" },
  style: { label: "画风", className: "bg-amber-100 text-amber-700" },
  member: { label: "成员", className: "bg-slate-100 text-slate-600" },
};

type TreeFilter = { type?: AssetType; seriesId?: string; ungrouped?: boolean };
type EditorState = { mode: "create" } | { mode: "edit"; asset: AssetSummary } | null;
type AssetView = "grid" | "list";

const ASSET_PAGE_SIZE = 12;

const rowCls = (active: boolean) =>
  `flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
    active ? "bg-slate-900 font-medium text-white" : "text-slate-600 hover:bg-slate-100"
  }`;
const countCls = (active: boolean) => (active ? "text-slate-300" : "text-slate-400");

const dragHandleCls =
  "flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing";

function SeriesTreeNode({
  type,
  group,
  active,
  onFilter,
}: {
  type: AssetType;
  group: { seriesId: string; name: string; count: number };
  active: boolean;
  onFilter: (filter: TreeFilter) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: `series:${type}:${group.seriesId}` });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-md ${isDragging ? "relative z-10 opacity-90" : ""}${
        isOver ? " ring-2 ring-blue-300" : ""
      }`}
    >
      <div className="flex items-center gap-1">
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`拖动合集 ${group.name}`}
          title="拖动排序合集"
          className={dragHandleCls}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onFilter({ type, seriesId: group.seriesId })}
          className={`min-w-0 flex-1 cursor-pointer ${rowCls(active)}`}
        >
          <FolderClosed className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span className="min-w-0 flex-1 truncate">{group.name}</span>
          <span className={countCls(active)}>{group.count}</span>
        </button>
      </div>
    </div>
  );
}

function UngroupedTreeNode({
  type,
  count,
  active,
  onFilter,
}: {
  type: AssetType;
  count: number;
  active: boolean;
  onFilter: (filter: TreeFilter) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `ungrouped:${type}` });

  return (
    <div className={`ml-6 rounded-md ${isOver ? "ring-2 ring-blue-300" : ""}`}>
      <button
        ref={setNodeRef}
        type="button"
        onClick={() => onFilter({ type, ungrouped: true })}
        className={`cursor-pointer ${rowCls(active)}`}
      >
        <span className="flex-1 text-slate-400">未归类</span>
        <span className={countCls(active)}>{count}</span>
      </button>
    </div>
  );
}

function AssetCard({
  asset,
  onEdit,
  onExtend,
  onDelete,
}: {
  asset: AssetSummary;
  onEdit: (asset: AssetSummary) => void;
  onExtend: (asset: AssetSummary) => void;
  onDelete: (asset: AssetSummary) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `asset:${asset.id}` });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      size="sm"
      className={`overflow-hidden pt-0 transition-shadow hover:shadow-md ${
        isDragging ? "relative z-10 opacity-90 shadow-lg" : ""
      }`}
    >
      <div className="group relative aspect-square overflow-hidden bg-slate-50">
        {asset.variants.filter((v) => v.image).length > 1 ? (
          <Carousel className="h-full w-full">
            <CarouselContent className="-ml-0 h-full">
              {asset.variants
                .filter((v) => v.image)
                .map((variant) => (
                  <CarouselItem key={variant.id} className="pl-0 h-full">
                    <PreviewImage
                      src={imageSrc(variant.image)}
                      alt={variant.name || asset.name}
                      className="h-full w-full rounded-none object-cover"
                    />
                  </CarouselItem>
                ))}
            </CarouselContent>
            <CarouselPrevious className="invisible group-hover:visible left-1 h-7 w-7" />
            <CarouselNext className="invisible group-hover:visible right-1 h-7 w-7" />
          </Carousel>
        ) : asset.primaryImage ? (
          <PreviewImage
            src={imageSrc(asset.primaryImage)}
            alt={asset.name}
            className="h-full w-full rounded-none object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-slate-100 text-xs text-slate-400">
            无图
          </div>
        )}
        <Badge
          variant="outline"
          className={`absolute left-2 top-2 cursor-pointer rounded-sm border-transparent px-1.5 ${
            TYPE_BADGE[asset.type].className
          }`}
        >
          {TYPE_BADGE[asset.type].label}
        </Badge>
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`拖动 ${asset.name}`}
          title="拖到其他卡片排序；拖到左侧合集/未归类改派"
          className="absolute right-2 top-2 flex h-7 w-7 cursor-grab items-center justify-center rounded-md bg-white/85 text-slate-500 shadow-sm backdrop-blur hover:bg-white hover:text-slate-700 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-2.5">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-800">{asset.name}</h3>
            <p className="mt-0.5 text-[10px] text-slate-400">{formatTime(asset.createdAt)}</p>
          </div>
          <Badge variant="secondary" className="shrink-0 rounded-sm px-1.5 text-[10px]">
            用 {asset.usageCount}
          </Badge>
        </div>

        <p className="line-clamp-2 min-h-7 text-[11px] leading-4 text-slate-500">
          {asset.type === "style" ? asset.stylePreset || "—" : asset.variants[0]?.appearance || "—"}
        </p>

        {asset.keywords && (
          <p className="line-clamp-1 text-[11px] text-slate-400" title={asset.keywords}>
            {asset.keywords}
          </p>
        )}

        <div className="min-h-5">
          {asset.seriesLinks.length === 0 ? (
            <span className="text-[11px] text-slate-300">未归类</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {asset.seriesLinks.slice(0, 2).map((link) => {
                const role = ROLE_BADGE[link.role] ?? ROLE_BADGE.member;
                return (
                  <Badge
                    key={link.seriesId}
                    variant="outline"
                    className={`cursor-pointer rounded-sm px-1.5 text-[10px] ${role.className}`}
                    title={`${link.seriesName} · ${role.label}`}
                  >
                    {link.seriesName}·{role.label}
                  </Badge>
                );
              })}
              {asset.seriesLinks.length > 2 && (
                <Badge variant="outline" className="rounded-sm px-1.5 text-[10px] text-slate-400">
                  +{asset.seriesLinks.length - 2}
                </Badge>
              )}
            </div>
          )}
        </div>

        <div className="mt-auto flex justify-end border-t border-slate-100 pt-1.5">
          <AssetActions asset={asset} onEdit={onEdit} onExtend={onExtend} onDelete={onDelete} />
        </div>
      </div>
    </Card>
  );
}

function AssetActions({
  asset,
  onEdit,
  onExtend,
  onDelete,
}: {
  asset: AssetSummary;
  onEdit: (asset: AssetSummary) => void;
  onExtend: (asset: AssetSummary) => void;
  onDelete: (asset: AssetSummary) => void;
}) {
  return (
    <div className="flex items-center">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onEdit(asset)}
        className="h-7 px-2 text-xs text-blue-600"
      >
        编辑
      </Button>
      {asset.type !== "style" && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onExtend(asset)}
          className="h-7 px-2 text-xs text-indigo-600"
        >
          扩展
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onDelete(asset)}
        className="h-7 px-2 text-xs text-red-500"
      >
        删除
      </Button>
    </div>
  );
}

function AssetDragPreview({ asset }: { asset: AssetSummary }) {
  return (
    <div className="w-44 overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200">
      <div className="aspect-square bg-slate-50">
        {asset.primaryImage ? (
          <img
            src={imageSrc(asset.primaryImage)}
            alt={asset.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">无图</div>
        )}
      </div>
      <div className="truncate px-3 py-2 text-xs font-medium text-slate-700">{asset.name}</div>
    </div>
  );
}

function AssetListItem({
  asset,
  onEdit,
  onExtend,
  onDelete,
}: {
  asset: AssetSummary;
  onEdit: (asset: AssetSummary) => void;
  onExtend: (asset: AssetSummary) => void;
  onDelete: (asset: AssetSummary) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `asset:${asset.id}` });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      size="sm"
      className={`flex-row items-center gap-3 p-2.5 ${
        isDragging ? "relative z-10 opacity-90 shadow-lg" : ""
      }`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`拖动 ${asset.name}`}
        title="拖到其他项排序；拖到左侧合集/未归类改派"
        className={dragHandleCls}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-slate-100">
        {asset.primaryImage ? (
          <PreviewImage
            src={imageSrc(asset.primaryImage)}
            alt={asset.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-slate-400">
            无图
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant="outline"
            className={`shrink-0 rounded-sm border-transparent px-1.5 ${TYPE_BADGE[asset.type].className}`}
          >
            {TYPE_BADGE[asset.type].label}
          </Badge>
          <h3 className="min-w-0 truncate text-sm font-semibold text-slate-800">{asset.name}</h3>
          <span className="ml-auto shrink-0 text-[11px] text-slate-400">用 {asset.usageCount}</span>
        </div>

        <p className="line-clamp-1 text-xs text-slate-500">
          {asset.type === "style" ? asset.stylePreset || "—" : asset.variants[0]?.appearance || "—"}
        </p>

        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[11px] text-slate-400" title={asset.keywords}>
            {asset.keywords || "—"}
          </p>
          <span className="hidden shrink-0 text-[11px] text-slate-400 md:inline">
            {formatTime(asset.createdAt)}
          </span>
        </div>
      </div>

      <div className="hidden min-w-28 shrink-0 flex-wrap gap-1 lg:flex">
        {asset.seriesLinks.slice(0, 2).map((link) => {
          const role = ROLE_BADGE[link.role] ?? ROLE_BADGE.member;
          return (
            <Badge
              key={link.seriesId}
              variant="outline"
              className={`rounded-sm px-1.5 text-[10px] ${role.className}`}
              title={`${link.seriesName} · ${role.label}`}
            >
              {link.seriesName}·{role.label}
            </Badge>
          );
        })}
        {asset.seriesLinks.length > 2 && (
          <Badge variant="outline" className="rounded-sm px-1.5 text-[10px] text-slate-400">
            +{asset.seriesLinks.length - 2}
          </Badge>
        )}
      </div>

      <AssetActions asset={asset} onEdit={onEdit} onExtend={onExtend} onDelete={onDelete} />
    </Card>
  );
}

export function AssetLibrary({ defaultSeriesId }: { defaultSeriesId?: string }) {
  const queryClient = useQueryClient();
  const [qInput, setQInput] = useState("");
  const [filter, setFilter] = useState<TreeFilter>(
    defaultSeriesId ? { seriesId: defaultSeriesId } : {},
  );
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editor, setEditor] = useState<EditorState>(null);
  const [extending, setExtending] = useState<AssetSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AssetSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [page, setPage] = useState(1);
  const [draggingAsset, setDraggingAsset] = useState<AssetSummary | null>(null);
  const [view, setView] = useState<AssetView>("grid");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const { data, isLoading, error } = useQuery({
    queryKey: ["assets", "library"],
    queryFn: () => api.getAssets(),
    staleTime: 10_000,
    retry: false,
  });
  const allAssets = data?.assets ?? [];

  const { data: seriesData } = useQuery({
    queryKey: ["series"],
    queryFn: () => api.getSeries(),
    staleTime: 30_000,
    retry: false,
  });
  const seriesOrderIndex = useMemo(() => {
    const index = new Map<string, number>();
    (seriesData?.series ?? []).forEach((series, order) => index.set(series.id, order));
    return index;
  }, [seriesData]);

  const kw = qInput.trim().toLowerCase();
  const matchesSearch = (asset: AssetSummary) =>
    !kw ||
    asset.name.toLowerCase().includes(kw) ||
    asset.variants.some(
      (variant) =>
        variant.name.toLowerCase().includes(kw) || variant.appearance.toLowerCase().includes(kw),
    ) ||
    (asset.type === "style" && (asset.stylePreset ?? "").toLowerCase().includes(kw)) ||
    asset.keywords.toLowerCase().includes(kw);
  const matchesFilter = (asset: AssetSummary) =>
    (!filter.type || asset.type === filter.type) &&
    (!filter.seriesId
      ? true
      : asset.seriesLinks.some((link) => link.seriesId === filter.seriesId)) &&
    (filter.ungrouped ? asset.seriesLinks.length === 0 : true);
  const assets = allAssets.filter((asset) => matchesFilter(asset) && matchesSearch(asset));

  const pageCount = Math.max(1, Math.ceil(assets.length / ASSET_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageAssets = assets.slice(
    (currentPage - 1) * ASSET_PAGE_SIZE,
    currentPage * ASSET_PAGE_SIZE,
  );

  useEffect(() => {
    setPage(1);
  }, [filter.type, filter.seriesId, filter.ungrouped, kw]);

  // 从合集详情页跳转过来时初始化筛选
  useEffect(() => {
    if (defaultSeriesId) {
      setFilter({ seriesId: defaultSeriesId });
      setPage(1);
    }
  }, [defaultSeriesId]);

  const seriesGroups = (type: AssetType) => {
    const groups = new Map<string, { name: string; count: number }>();
    for (const asset of allAssets) {
      if (asset.type !== type) continue;
      for (const link of asset.seriesLinks) {
        const group = groups.get(link.seriesId) ?? { name: link.seriesName, count: 0 };
        group.count += 1;
        groups.set(link.seriesId, group);
      }
    }

    return [...groups.entries()]
      .map(([seriesId, group]) => ({ seriesId, ...group }))
      .sort((left, right) => {
        const leftOrder = seriesOrderIndex.get(left.seriesId) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = seriesOrderIndex.get(right.seriesId) ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || left.name.localeCompare(right.name, "zh-Hans-CN");
      });
  };
  const ungroupedCount = (type: AssetType) =>
    allAssets.filter((asset) => asset.type === type && asset.seriesLinks.length === 0).length;
  const typeCount = (type: AssetType) => allAssets.filter((asset) => asset.type === type).length;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["assets"] });
    void queryClient.invalidateQueries({ queryKey: ["series"] });
  };

  function defaultRoleFor(type: AssetType): string {
    if (type === "style") return "style";
    if (type === "scene") return "scene";
    return "member";
  }

  async function handleAssign(assetId: string, seriesId: string | null, seriesName?: string) {
    const asset = allAssets.find((item) => item.id === assetId);
    if (!asset) return;
    if (seriesId && asset.seriesLinks.some((link) => link.seriesId === seriesId)) {
      toast.info(`「${asset.name}」已属于合集「${seriesName ?? ""}」`);
      return;
    }
    if (!seriesId && asset.seriesLinks.length === 0) {
      toast.info(`「${asset.name}」已是未归类`);
      return;
    }

    const previous = queryClient.getQueryData<{ assets: AssetSummary[] }>(["assets", "library"]);
    if (!previous) return;
    const nextLinks: AssetSummary["seriesLinks"] = seriesId
      ? [
          ...asset.seriesLinks,
          { seriesId, seriesName: seriesName ?? "", role: defaultRoleFor(asset.type) },
        ]
      : [];
    const next = {
      ...previous,
      assets: previous.assets.map((item) =>
        item.id === assetId ? { ...item, seriesLinks: nextLinks } : item,
      ),
    };

    flushSync(() => queryClient.setQueryData(["assets", "library"], next));
    try {
      await api.updateAsset(assetId, { seriesLinks: nextLinks });
      toast.success(
        seriesId
          ? `已将「${asset.name}」归入合集「${seriesName ?? ""}」`
          : `已移除「${asset.name}」的全部合集关联`,
      );
    } catch (err) {
      flushSync(() => queryClient.setQueryData(["assets", "library"], previous));
      toast.error(err instanceof Error ? err.message : "改派失败");
    }
  }

  const reorderAssets = makeReorder<AssetSummary, { assets: AssetSummary[] }>(queryClient, {
    queryKey: ["assets", "library"],
    getItems: (data) => data.assets,
    apply: (data, next) => ({ ...data, assets: next }),
    idOf: (asset) => asset.id,
    persist: ({ order }) => api.reorderAssets(order),
    successMsg: "资产顺序已更新",
  });

  const reorderSeries = makeReorder<SeriesSummary, { series: SeriesSummary[] }>(queryClient, {
    queryKey: ["series"],
    getItems: (data) => data.series,
    apply: (data, next) => ({ ...data, series: next }),
    idOf: (series) => series.id,
    persist: ({ order }) => api.reorderSeries(order),
    successMsg: "合集顺序已更新",
  });

  function requestDelete(asset: AssetSummary) {
    setDeleteTarget(asset);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteAsset(deleteTarget.id);
      toast.success("已删除资产");
      refresh();
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (!id.startsWith("asset:")) return;
    const assetId = id.slice("asset:".length);
    setDraggingAsset(allAssets.find((asset) => asset.id === assetId) ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingAsset(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    if (activeId.startsWith("asset:")) {
      const assetId = activeId.slice("asset:".length);
      if (overId.startsWith("series:")) {
        const seriesId = overId.split(":")[2];
        const seriesName = seriesData?.series.find((series) => series.id === seriesId)?.name;
        void handleAssign(assetId, seriesId, seriesName);
        return;
      }
      if (overId.startsWith("ungrouped:")) {
        void handleAssign(assetId, null);
        return;
      }
      if (overId.startsWith("asset:") && overId !== activeId) {
        void reorderAssets(assetId, overId.slice("asset:".length));
      }
      return;
    }

    if (activeId.startsWith("series:") && overId.startsWith("series:")) {
      const activeParts = activeId.split(":");
      const overParts = overId.split(":");
      if (activeParts[1] === overParts[1] && activeParts[2] !== overParts[2]) {
        void reorderSeries(activeParts[2] ?? "", overParts[2] ?? "");
      }
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">主体资产库</h1>
          <p className="mt-1 text-sm text-slate-500">
            共 {allAssets.length} 个主体，可拖拽排序与归类
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={qInput}
            onChange={(event) => setQInput(event.target.value)}
            placeholder="搜索名称 / 关键词 / 外观设定"
            className="w-64 py-1.5"
          />
          <Button onClick={() => setEditor({ mode: "create" })} className="px-4 py-2">
            新建资产
          </Button>
          <ToggleGroup
            type="single"
            value={view}
            variant="outline"
            onValueChange={(value) => setView(value === "list" ? "list" : "grid")}
          >
            <ToggleGroupItem value="grid" aria-label="卡片布局" title="卡片布局">
              <LayoutGrid className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="列表布局" title="列表布局">
              <List className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggingAsset(null)}
      >
        <div className="flex items-start gap-4">
          <aside className="w-64 shrink-0 rounded-xl bg-white p-2 shadow-sm">
            <button
              onClick={() => setFilter({})}
              className={`cursor-pointer ${rowCls(filter.type === undefined)}`}
            >
              <Layers className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">全部</span>
              <span className={countCls(filter.type === undefined)}>{allAssets.length}</span>
            </button>
            <p className="px-2 pb-1 pt-0.5 text-[11px] leading-4 text-slate-400">
              拖动卡片到合集 / 未归类可改派；拖动左侧合集可排序
            </p>

            {TYPE_TABS.map((tab) => {
              const key = `type:${tab.key}`;
              const isOpen = !collapsed[key];
              const groups = seriesGroups(tab.key);
              const activeType =
                filter.type === tab.key &&
                filter.seriesId === undefined &&
                filter.ungrouped === undefined;

              return (
                <div key={tab.key} className="mt-0.5">
                  <div className="flex items-center">
                    <button
                      onClick={() => setCollapsed((current) => ({ ...current, [key]: isOpen }))}
                      aria-label={isOpen ? "折叠" : "展开"}
                      className="cursor-pointer rounded-md p-1 text-slate-400 hover:bg-slate-100"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => setFilter({ type: tab.key })}
                      className={`min-w-0 flex-1 cursor-pointer ${rowCls(activeType)}`}
                    >
                      <span className="flex-1 truncate">{tab.label}</span>
                      <span className={countCls(activeType)}>{typeCount(tab.key)}</span>
                    </button>
                  </div>

                  {isOpen && (
                    <div className="ml-[15px] border-l border-slate-100 pl-1.5">
                      <SortableContext
                        items={groups.map((group) => `series:${tab.key}:${group.seriesId}`)}
                        strategy={verticalListSortingStrategy}
                      >
                        {groups.map((group) => (
                          <SeriesTreeNode
                            key={group.seriesId}
                            type={tab.key}
                            group={group}
                            active={filter.type === tab.key && filter.seriesId === group.seriesId}
                            onFilter={setFilter}
                          />
                        ))}
                      </SortableContext>
                      <UngroupedTreeNode
                        type={tab.key}
                        count={ungroupedCount(tab.key)}
                        active={filter.type === tab.key && filter.ungrouped === true}
                        onFilter={setFilter}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </aside>

          <section className="min-w-0 flex-1 space-y-4 rounded-xl bg-slate-50/70 p-4 shadow-sm">
            {isLoading ? (
              view === "grid" ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Card key={i} size="sm" className="overflow-hidden pt-0">
                      <Skeleton className="aspect-square w-full rounded-none" />
                      <div className="space-y-2 p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <Skeleton className="h-4 flex-1" />
                          <Skeleton className="h-4 w-10 shrink-0" />
                        </div>
                        <Skeleton className="h-7 w-full" />
                        <div className="flex gap-1">
                          <Skeleton className="h-5 w-16" />
                          <Skeleton className="h-5 w-16" />
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Card key={i} size="sm" className="flex-row items-center gap-3 p-2.5">
                      <Skeleton className="h-14 w-14 shrink-0 rounded-md" />
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <Skeleton className="h-4 w-1/3" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </Card>
                  ))}
                </div>
              )
            ) : error ? (
              <p className="py-16 text-center text-sm text-red-500">
                加载失败：{error instanceof Error ? error.message : String(error)}
              </p>
            ) : (
              <SortableContext
                items={pageAssets.map((asset) => `asset:${asset.id}`)}
                strategy={view === "grid" ? rectSortingStrategy : verticalListSortingStrategy}
              >
                {assets.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white py-16 text-center text-sm whitespace-normal text-slate-400">
                    暂无资产：可先新建画风主体，或在向导中「存为资产」「扩展生成」
                  </div>
                ) : view === "grid" ? (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                    {pageAssets.map((asset) => (
                      <AssetCard
                        key={asset.id}
                        asset={asset}
                        onEdit={(item) => setEditor({ mode: "edit", asset: item })}
                        onExtend={setExtending}
                        onDelete={(item) => requestDelete(item)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pageAssets.map((asset) => (
                      <AssetListItem
                        key={asset.id}
                        asset={asset}
                        onEdit={(item) => setEditor({ mode: "edit", asset: item })}
                        onExtend={setExtending}
                        onDelete={(item) => requestDelete(item)}
                      />
                    ))}
                  </div>
                )}
              </SortableContext>
            )}

            {!isLoading && !error && assets.length > 0 && (
              <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
                <span className="text-sm text-slate-500">
                  第 {(currentPage - 1) * ASSET_PAGE_SIZE + 1}-
                  {Math.min(currentPage * ASSET_PAGE_SIZE, assets.length)} 条，共 {assets.length} 条
                </span>
                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        disabled={currentPage <= 1}
                        onClick={() => setPage(currentPage - 1)}
                      />
                    </PaginationItem>
                    {getPageItems(currentPage, pageCount).map((item, index) =>
                      item === "ellipsis" ? (
                        <PaginationItem key={`ellipsis-${index}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      ) : (
                        <PaginationItem key={item}>
                          <PaginationLink
                            isActive={item === currentPage}
                            onClick={() => setPage(item)}
                          >
                            {item}
                          </PaginationLink>
                        </PaginationItem>
                      ),
                    )}
                    <PaginationItem>
                      <PaginationNext
                        disabled={currentPage >= pageCount}
                        onClick={() => setPage(currentPage + 1)}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </section>
        </div>

        <DragOverlay>
          {draggingAsset ? <AssetDragPreview asset={draggingAsset} /> : null}
        </DragOverlay>
      </DndContext>

      {editor && (
        <AssetEditor
          mode={editor.mode}
          asset={editor.mode === "edit" ? editor.asset : undefined}
          onClose={() => setEditor(null)}
        />
      )}
      {extending && <AssetExtend asset={extending} onClose={() => setExtending(null)} />}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除资产</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除资产「{deleteTarget?.name}」？此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
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
