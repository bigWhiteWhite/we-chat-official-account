"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, TagsIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api, formatTime, type TagRow } from "@/lib/api";
import { getPageItems } from "@/lib/pagination";

/** 标签库每页条数 */
const TAG_PAGE_SIZE = 20;

type SortKey = "name" | "usage" | "updatedAt";

/** 使用说明过滤：全部 / 已填写 / 缺失 */
const DESC_FILTERS = [
  { value: "all", label: "全部" },
  { value: "filled", label: "已填写" },
  { value: "missing", label: "缺失" },
] as const;

/** 使用范围过滤：全部 / 被任务用 / 被合集用 / 完全未使用 */
const USAGE_FILTERS = [
  { value: "all", label: "全部" },
  { value: "task", label: "已被任务使用" },
  { value: "series", label: "已被合集使用" },
  { value: "unused", label: "未被使用" },
] as const;

/** 标签新建 / 编辑对话框：说明即 LLM 行为说明书，保存后注入后续选题与剧本生成 */
function TagFormDialog({
  open,
  onOpenChange,
  tag,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 传入则为编辑，不传为新建 */
  tag?: TagRow | null;
}) {
  const queryClient = useQueryClient();
  const editing = !!tag;

  const form = useForm({
    defaultValues: { name: "", description: "" },
    onSubmit: async ({ value }) => {
      if (!value.name.trim()) {
        toast.error("请填写标签名称");
        return;
      }
      try {
        if (editing) {
          await api.updateTag(tag!.id, { name: value.name.trim(), description: value.description });
        } else {
          await api.createTag({ name: value.name.trim(), description: value.description });
        }
        toast.success(editing ? "标签已更新" : "标签已创建");
        void queryClient.invalidateQueries({ queryKey: ["tags"] });
        void queryClient.invalidateQueries({ queryKey: ["series"] });
        void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "保存标签失败");
      }
    },
  });
  const values = useStore(form.store, (s) => s.values);

  // 打开时按编辑目标重填（新建清空）；渲染期写外部 store 会触发 React 告警，故走 effect
  useEffect(() => {
    if (!open) return;
    form.setFieldValue("name", tag?.name ?? "");
    form.setFieldValue("description", tag?.description ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tag]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑标签" : "新建标签"}</DialogTitle>
          <DialogDescription>
            标签说明会注入选题与剧本提示词，是 AI 的创作要求（如叙事格式、基调、禁忌）。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="tag-name">名称</Label>
            <Input
              id="tag-name"
              value={values.name}
              onChange={(e) => form.setFieldValue("name", e.target.value)}
              maxLength={20}
              placeholder="如：古风古代、无对白条漫"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tag-desc">说明（LLM 行为说明书，可留空）</Label>
            <Textarea
              id="tag-desc"
              rows={5}
              value={values.description}
              onChange={(e) => form.setFieldValue("description", e.target.value)}
              maxLength={2000}
              placeholder="如：架空古代背景，以现代视角趣味讲解历史典故；人物着古装但语言现代化；禁止出现说书人旁白角色…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <form.Subscribe selector={(s) => ({ isSubmitting: s.isSubmitting, name: s.values.name })}>
            {({ isSubmitting, name }) => (
              <Button
                onClick={() => void form.handleSubmit()}
                disabled={isSubmitting || !name.trim()}
              >
                {isSubmitting ? "保存中…" : editing ? "保存修改" : "创建标签"}
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 标签库管理页：搜索 + 筛选 + 表格（排序 / 多选批量删除）+ 新建编辑删除 */
export function TagLibrary() {
  const [formOpen, setFormOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<TagRow | null>(null);
  /** 待删除标签（单条或批量走同一确认框） */
  const [deleting, setDeleting] = useState<TagRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "name", desc: false });

  const [q, setQ] = useState("");
  const [usage, setUsage] = useState<(typeof USAGE_FILTERS)[number]["value"]>("all");
  const [descState, setDescState] = useState<(typeof DESC_FILTERS)[number]["value"]>("all");

  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["tags"],
    queryFn: () => api.getTags(),
    retry: false,
  });
  const tags = data?.tags ?? [];

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const hit = tags.filter((t) => {
      if (kw && !`${t.name} ${t.description}`.toLowerCase().includes(kw)) return false;
      if (usage === "task" && t.taskCount === 0) return false;
      if (usage === "series" && t.seriesCount === 0) return false;
      if (usage === "unused" && t.taskCount + t.seriesCount > 0) return false;
      if (descState === "filled" && !t.description.trim()) return false;
      if (descState === "missing" && t.description.trim()) return false;
      return true;
    });
    const dir = sort.desc ? -1 : 1;
    return hit.sort((a, b) => {
      if (sort.key === "name") return a.name.localeCompare(b.name, "zh-CN") * dir;
      if (sort.key === "usage") {
        return (a.taskCount + a.seriesCount - (b.taskCount + b.seriesCount)) * dir;
      }
      return (Date.parse(a.updatedAt) - Date.parse(b.updatedAt)) * dir;
    });
  }, [tags, q, usage, descState, sort]);

  const pageCount = Math.max(1, Math.ceil(rows.length / TAG_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = rows.slice((currentPage - 1) * TAG_PAGE_SIZE, currentPage * TAG_PAGE_SIZE);
  const pageIds = pageRows.map((t) => t.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someSelected = pageIds.some((id) => selected.has(id));
  const selectedTags = tags.filter((t) => selected.has(t.id));

  useEffect(() => {
    setPage(1);
  }, [q, usage, descState, sort]);

  function onSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, desc: !s.desc } : { key, desc: key === "name" ? false : true },
    );
  }

  function resetFilters() {
    setQ("");
    setUsage("all");
    setDescState("all");
  }

  async function onDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      const ids = deleting.map((t) => t.id);
      if (ids.length === 1) {
        await api.deleteTag(ids[0]!);
      } else {
        await api.deleteTags(ids);
      }
      toast.success(`已删除 ${ids.length} 个标签`);
      setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
      void queryClient.invalidateQueries({ queryKey: ["tags"] });
      void queryClient.invalidateQueries({ queryKey: ["series"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除标签失败");
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  const unbindTasks = deleting?.reduce((n, t) => n + t.taskCount, 0) ?? 0;
  const unbindSeries = deleting?.reduce((n, t) => n + t.seriesCount, 0) ?? 0;

  return (
    <div className="mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">标签库</h1>
          <p className="mt-1 text-sm text-slate-500">
            内容标签 = 名称 + 说明；说明作为创作要求注入选题与剧本生成（替代旧题材方向/类别）
          </p>
        </div>
        <Button
          className="cursor-pointer gap-1.5"
          onClick={() => {
            setEditingTag(null);
            setFormOpen(true);
          }}
        >
          <Plus /> 新建标签
        </Button>
      </div>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <Label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            名称 / 说明
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="模糊搜索标签名或说明"
              className="w-52"
            />
          </Label>
          <Label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            使用情况
            <Select value={usage} onValueChange={(v) => setUsage(v as typeof usage)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                {USAGE_FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            说明状态
            <Select value={descState} onValueChange={(v) => setDescState(v as typeof descState)}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                {DESC_FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Button variant="outline" className="h-9 px-4" onClick={resetFilters}>
            重置
          </Button>
          <span className="ml-auto text-sm text-slate-500">
            共 {tags.length} 个标签，筛选后 {rows.length} 个
          </span>
        </div>
      </section>

      <section className="rounded-xl bg-white shadow-sm">
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <TooltipProvider>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs text-slate-400">
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="全选"
                        checked={allSelected ? true : someSelected ? "indeterminate" : false}
                        onCheckedChange={(c) =>
                          setSelected(
                            c === true
                              ? new Set([...selected, ...pageIds])
                              : new Set([...selected].filter((id) => !pageIds.includes(id))),
                          )
                        }
                        className="size-4"
                      />
                    </TableHead>
                    {(
                      [
                        { key: "name", label: "名称", className: "w-32" },
                        { key: null, label: "说明（注入 LLM 的创作要求）", className: "" },
                        { key: "usage", label: "使用", className: "w-28" },
                        { key: "updatedAt", label: "更新时间", className: "w-36" },
                      ] as const
                    ).map((col) => (
                      <TableHead
                        key={col.label}
                        className={col.className}
                        onClick={col.key ? () => onSort(col.key as SortKey) : undefined}
                        aria-sort={
                          col.key && sort.key === col.key
                            ? sort.desc
                              ? "descending"
                              : "ascending"
                            : undefined
                        }
                      >
                        <span
                          className={`inline-flex items-center gap-1 ${col.key ? "cursor-pointer select-none hover:text-slate-600" : ""}`}
                        >
                          {col.label}
                          {col.key &&
                            sort.key === col.key &&
                            (sort.desc ? (
                              <ArrowDown className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowUp className="h-3.5 w-3.5" />
                            ))}
                        </span>
                      </TableHead>
                    ))}
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-12 text-center text-sm text-slate-400">
                        {tags.length === 0 ? (
                          <span className="flex flex-col items-center gap-2">
                            <TagsIcon className="h-8 w-8" />
                            暂无标签，点右上角「新建标签」创建
                          </span>
                        ) : (
                          "没有匹配的标签，试试调整搜索或筛选条件"
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    pageRows.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>
                          <Checkbox
                            aria-label={`选择标签 ${t.name}`}
                            checked={selected.has(t.id)}
                            onCheckedChange={(c) => {
                              const next = new Set(selected);
                              if (c === true) next.add(t.id);
                              else next.delete(t.id);
                              setSelected(next);
                            }}
                            className="size-4"
                          />
                        </TableCell>
                        <TableCell className="font-medium whitespace-nowrap text-slate-900">
                          {t.name}
                          {!t.description.trim() && (
                            <Badge
                              variant="outline"
                              className="ml-1.5 rounded-sm px-1 py-0 text-[10px] text-amber-600"
                            >
                              缺说明
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="max-w-0 whitespace-normal text-slate-500">
                          {t.description ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTag(t);
                                    setFormOpen(true);
                                  }}
                                  className="line-clamp-2 w-full cursor-pointer text-left text-sm hover:text-slate-700"
                                >
                                  {t.description}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-sm">
                                <p className="text-xs leading-relaxed whitespace-pre-wrap">
                                  {t.description}
                                </p>
                                <p className="mt-1 text-[10px] text-slate-400">点击编辑该标签</p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-sm text-slate-300">未填写</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          任务 {t.taskCount} · 合集 {t.seriesCount}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-slate-400">
                          {formatTime(t.updatedAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 cursor-pointer text-slate-400 hover:text-slate-700"
                              title="编辑"
                              onClick={() => {
                                setEditingTag(t);
                                setFormOpen(true);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 cursor-pointer text-slate-400 hover:text-red-600"
                              title="删除"
                              onClick={() => setDeleting([t])}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TooltipProvider>
        )}

        {!isLoading && rows.length > TAG_PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2">
            <span className="text-sm text-slate-500">
              第 {(currentPage - 1) * TAG_PAGE_SIZE + 1}-
              {Math.min(currentPage * TAG_PAGE_SIZE, rows.length)} 条，共 {rows.length} 条
            </span>
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    disabled={currentPage <= 1}
                    onClick={() => setPage(currentPage - 1)}
                  />
                </PaginationItem>
                {getPageItems(currentPage, pageCount).map((item, idx) =>
                  item === "ellipsis" ? (
                    <PaginationItem key={`ellipsis-${idx}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={item}>
                      <PaginationLink isActive={item === currentPage} onClick={() => setPage(item)}>
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

        {selected.size > 0 && (
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-2">
            <span className="text-sm text-slate-600">已选 {selected.size} 项</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={() => setSelected(new Set())}
              >
                取消选择
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="cursor-pointer"
                disabled={busy}
                onClick={() => setDeleting(selectedTags)}
              >
                批量删除
              </Button>
            </div>
          </div>
        )}
      </section>

      <TagFormDialog
        key={editingTag?.id ?? "new"}
        open={formOpen}
        onOpenChange={setFormOpen}
        tag={editingTag}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleting && deleting.length > 1
                ? `删除已选的 ${deleting.length} 个标签？`
                : `删除标签「${deleting?.[0]?.name}」？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              将从 {unbindTasks} 个任务、{unbindSeries}{" "}
              个合集中解绑（任务与合集本身不受影响），历史剧本不会回改。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="cursor-pointer bg-red-600 text-white hover:bg-red-700"
              disabled={busy}
              onClick={() => void onDelete()}
            >
              {busy ? "删除中…" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
