"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, FolderClosed, FolderOpen, List, Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover as PopoverPrimitive } from "radix-ui";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TreeView, type TreeDataItem } from "@/components/tree-view";
import { PreviewGroup, PreviewImage, preventLightboxInteract } from "@/components/photo-viewer";
import { cn } from "@/lib/utils";

/** TreeSelect 选项（树形叶子 / 列表行共用） */
export type TreeSelectItem = {
  id: string;
  name: string;
  /** 次要说明（关键词 / 外观等，参与搜索） */
  description?: string;
  /** 缩略图 URL（资产选择场景传 imageSrc() 结果） */
  image?: string | null;
  disabled?: boolean;
};

/** 树形分组（合集 / 未归类等） */
export type TreeSelectGroup = {
  key: string;
  label: string;
  items: TreeSelectItem[];
};

type TreeSelectView = "tree" | "list";
/** 多选触发器上最多平铺的已选项数，其余折叠为 +N */
const SELECTED_CHIPS = 3;
/**
 * 通用下拉树形选择框：顶部搜索 + 树形/列表视图切换。
 * 单选（value/onValueChange）与多选（multiple + selectedIds/onToggle）两种模式；
 * 资产选择等场景经此组件统一交互，树节点渲染复用 tree-view.tsx。
 */
export function TreeSelect({
  groups,
  value,
  onValueChange,
  multiple,
  selectedIds,
  onToggle,
  triggerLabel,
  placeholder = "请选择…",
  searchPlaceholder = "搜索…",
  newLabel,
  disabled,
  emptyText = "暂无可选项",
  triggerClassName,
}: {
  groups: TreeSelectGroup[];
  /** 单选值（multiple=false 时生效） */
  value?: string | null;
  onValueChange?: (id: string | null) => void;
  /** 多选模式：勾选不关闭面板 */
  multiple?: boolean;
  selectedIds?: string[];
  onToggle?: (id: string) => void;
  /** 多选触发器左侧文案（如「画风（必选，可多选）· 提示」） */
  triggerLabel?: ReactNode;
  placeholder?: string;
  searchPlaceholder?: string;
  /** 单选清空项文案（如「不使用库画风」），传入才显示 */
  newLabel?: string;
  disabled?: boolean;
  emptyText?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<TreeSelectView>("tree");
  const kw = query.trim().toLowerCase();

  const filteredGroups = useMemo(
    () =>
      kw
        ? groups
            .map((g) => ({
              ...g,
              items: g.items.filter(
                (i) =>
                  i.name.toLowerCase().includes(kw) ||
                  (i.description ?? "").toLowerCase().includes(kw),
              ),
            }))
            .filter((g) => g.items.length > 0)
        : groups,
    [groups, kw],
  );
  const flatFiltered = useMemo(() => filteredGroups.flatMap((g) => g.items), [filteredGroups]);
  const flatAll = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const selected = value ? (flatAll.find((i) => i.id === value) ?? null) : null;
  const isSelected = (id: string) =>
    multiple ? (selectedIds?.includes(id) ?? false) : value === id;
  /** 多选触发器上的已选胶囊（按分组顺序，超出折叠为 +N） */
  const selectedItems = multiple
    ? flatAll.filter((i) => selectedIds?.includes(i.id)).slice(0, SELECTED_CHIPS)
    : [];
  const selectedRest = multiple ? (selectedIds?.length ?? 0) - selectedItems.length : 0;
  /** 搜索无命中与真的没有候选是两种情况，空态文案要分开 */
  const emptyLabel = kw ? "无匹配项" : emptyText;

  function pick(item: TreeSelectItem) {
    if (item.disabled) return;
    if (multiple) {
      onToggle?.(item.id);
      return;
    }
    onValueChange?.(item.id);
    setOpen(false);
  }
  /** 叶子行内容（树形 renderItem 与列表行共用；缩略图用小圆角，点击放大不触发选中） */
  const itemRow = (item: TreeSelectItem) => {
    const on = isSelected(item.id);
    return (
      <>
        {item.image ? (
          <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <PreviewImage
              src={item.image}
              alt=""
              className="h-6 w-6 rounded-sm border border-slate-200 object-cover"
            />
          </span>
        ) : (
          <span className="h-6 w-6 shrink-0 rounded-sm border border-dashed border-slate-300" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{item.name}</span>
          {item.description ? (
            <span className="block truncate text-xs text-slate-400">{item.description}</span>
          ) : null}
        </span>
        {on && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
      </>
    );
  };

  // 搜索时强制全部展开（expandAll 需要非空 initialSelectedItemId 才生效）；
  // 非搜索时只展开选中项所在分组，其余默认收起
  const treeData: TreeDataItem[] = filteredGroups.map((g) => ({
    id: `group:${g.key}`,
    name: g.label,
    children: g.items.map((i) => ({
      id: i.id,
      name: i.name,
      disabled: i.disabled,
      onClick: () => pick(i),
    })),
  }));
  const initialTreeId = kw ? (flatFiltered[0]?.id ?? undefined) : (value ?? undefined);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-auto min-h-9 w-full cursor-pointer flex-wrap items-center justify-between gap-2 py-1.5 font-normal",
            triggerClassName,
          )}
        >
          {multiple ? (
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <span className="max-w-full truncate text-sm">{triggerLabel ?? placeholder}</span>
              {selectedItems.map((i) => (
                <Badge
                  key={i.id}
                  variant="secondary"
                  className="max-w-32 gap-1 rounded-full py-0.5 text-[10px] font-normal"
                >
                  <span className="truncate">{i.name}</span>
                </Badge>
              ))}
              {selectedRest > 0 && (
                <span className="text-[10px] text-slate-400">+{selectedRest}</span>
              )}
            </span>
          ) : selected ? (
            <span className="flex min-w-0 items-center gap-2">
              {selected.image && (
                <span
                  className="shrink-0"
                  onClick={(e) => e.stopPropagation()}
                  // Radix Trigger 在 pointerdown 就展开下拉，预览点击需一起拦下
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <PreviewImage
                    src={selected.image}
                    alt=""
                    className="h-5 w-5 rounded object-cover"
                  />
                </span>
              )}
              <span className="truncate text-sm">{selected.name}</span>
              <span
                role="button"
                tabIndex={0}
                className="ml-auto flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                onClick={(e) => {
                  e.stopPropagation();
                  onValueChange?.(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    onValueChange?.(null);
                  }
                }}
              >
                <X className="h-3 w-3" />
              </span>
            </span>
          ) : (
            <span className="truncate text-sm text-slate-400">{triggerLabel ?? placeholder}</span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {multiple && (selectedIds?.length ?? 0) > 0 && (
              <Badge variant="secondary" className="shrink-0 rounded-full px-2 text-[10px]">
                已选 {selectedIds?.length}
              </Badge>
            )}
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-slate-400 transition-transform",
                open && "rotate-180",
              )}
            />
          </div>
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Content
        align="start"
        sideOffset={4}
        className="z-50 w-[var(--radix-popper-anchor-width)] min-w-64 rounded-md border border-slate-200 bg-white shadow-lg outline-none"
        onPointerDownOutside={preventLightboxInteract}
        onInteractOutside={preventLightboxInteract}
        onEscapeKeyDown={preventLightboxInteract}
      >
        <div className="flex items-center gap-2 border-b border-slate-100 p-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 pl-7 text-xs"
            />
          </div>
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(v) => v && setView(v as TreeSelectView)}
            variant="outline"
            size="sm"
            spacing={0}
            className="shrink-0"
          >
            <ToggleGroupItem
              value="tree"
              title="树形"
              aria-label="树形"
              className="cursor-pointer px-1.5"
            >
              <FolderClosed className="h-3.5 w-3.5" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="list"
              title="列表"
              aria-label="列表"
              className="cursor-pointer px-1.5"
            >
              <List className="h-3.5 w-3.5" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {/* 灯箱共享一个 PhotoProvider：树形/列表内的缩略图可点击放大并左右切换 */}
        <PreviewGroup>
          {view === "tree" ? (
            treeData.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-400">{emptyLabel}</p>
            ) : (
              <div className="h-60 overflow-y-auto overscroll-contain">
                {newLabel && !multiple && (
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-50"
                    onClick={() => {
                      onValueChange?.(null);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-dashed border-slate-300 text-xs text-slate-400">
                      +
                    </span>
                    {newLabel}
                  </button>
                )}
                <TreeView
                  data={treeData}
                  initialSelectedItemId={initialTreeId}
                  expandAll={!!kw}
                  renderItem={({ item, isLeaf, isOpen }) => {
                    if (!isLeaf) {
                      const group = filteredGroups.find((g) => `group:${g.key}` === item.id);
                      return (
                        <span className="flex w-full items-center gap-1 text-xs font-semibold text-slate-500">
                          {isOpen ? (
                            <FolderOpen className="h-3.5 w-3.5" />
                          ) : (
                            <FolderClosed className="h-3.5 w-3.5" />
                          )}
                          <span className="flex-1 truncate text-left">
                            {group?.label ?? item.name}
                          </span>
                          <span className="text-slate-400">{group?.items.length ?? 0}</span>
                        </span>
                      );
                    }
                    const leaf = flatFiltered.find((i) => i.id === item.id);
                    return leaf ? itemRow(leaf) : item.name;
                  }}
                />
              </div>
            )
          ) : (
            <div className="h-60 overflow-y-auto overscroll-contain py-1">
              {newLabel && !multiple && (
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-50"
                  onClick={() => {
                    onValueChange?.(null);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-dashed border-slate-300 text-xs text-slate-400">
                    +
                  </span>
                  {newLabel}
                </button>
              )}
              {flatFiltered.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  disabled={i.disabled}
                  onClick={() => pick(i)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50",
                    isSelected(i.id) && "bg-slate-100",
                  )}
                >
                  {itemRow(i)}
                </button>
              ))}
              {flatFiltered.length === 0 && !newLabel && (
                <p className="px-3 py-4 text-center text-xs text-slate-400">{emptyLabel}</p>
              )}
            </div>
          )}
        </PreviewGroup>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Root>
  );
}
