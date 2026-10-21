"use client";

import { useEffect, useRef, useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { flexRender } from "@tanstack/react-table";
import { getCoreRowModel, getSortedRowModel, useLegacyTable } from "@tanstack/react-table/legacy";
import type { LegacyColumnDef } from "@tanstack/react-table/legacy";
import { Check, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { toast } from "sonner";
import { api, formatTime, type TaskSummary } from "@/lib/api";
import { SOURCE_LABELS, statusMeta } from "@/lib/status";
import { useUiStore } from "@/store/ui";

const PROCESSING = ["collecting", "writing", "drawing", "publishing"];

/** 任务列表每页条数 */
const TASK_PAGE_SIZE = 20;

function StatusBadge({ status }: { status: string }) {
  const meta = statusMeta(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
    >
      {meta.spinner && (
        <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
      )}
      {meta.label}
    </span>
  );
}

/** 表格合集列：Popover + Command 多选编辑归属；勾选即保存（乐观更新，失败回滚），主合集由服务端自动顺延 */
function SeriesCell({
  task,
  seriesList,
}: {
  task: TaskSummary;
  seriesList: Array<{ id: string; name: string }>;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  // 即时保存：请求串行化保证服务端最终状态与最新勾选一致；savedRef 记录最后成功落库的选择用于失败回滚
  const latestRef = useRef<Set<string>>(new Set());
  const savedRef = useRef<Set<string>>(new Set());
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const primary = task.seriesLinks[0] ?? null;

  function toggle(id: string) {
    const next = new Set(latestRef.current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    latestRef.current = next;
    setSel(next);
    chainRef.current = chainRef.current.then(async () => {
      setPending(true);
      try {
        await api.updateTaskSeries(task.taskId, [...latestRef.current]);
        savedRef.current = new Set(latestRef.current);
        void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      } catch (err) {
        latestRef.current = new Set(savedRef.current);
        setSel(new Set(savedRef.current));
        toast.error(err instanceof Error ? err.message : "保存失败");
      } finally {
        setPending(false);
      }
    });
  }

  if (seriesList.length === 0) {
    return <span className="text-sm text-slate-600">—</span>;
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) {
          const initial = new Set(task.seriesLinks.map((l) => l.seriesId));
          setSel(initial);
          latestRef.current = initial;
          savedRef.current = initial;
        }
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title="点击修改所属合集"
          className="-mx-1 cursor-pointer rounded px-1 py-0.5 text-left hover:bg-slate-100"
        >
          {primary ? (
            <span className="text-sm whitespace-nowrap text-slate-600">
              {primary.seriesName}
              {task.episodeNo != null && (
                <span className="ml-1 text-slate-400">· 第{task.episodeNo}集</span>
              )}
              {task.seriesLinks.length > 1 && (
                <Badge variant="secondary" className="ml-1 rounded-full px-1.5 text-[10px]">
                  +{task.seriesLinks.length - 1}
                </Badge>
              )}
            </span>
          ) : (
            <span className="text-sm whitespace-nowrap text-slate-400">设置</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          <CommandInput placeholder="搜索合集…" />
          <CommandList>
            <CommandEmpty>无匹配合集</CommandEmpty>
            <CommandGroup>
              {seriesList.map((s) => (
                <CommandItem
                  key={s.id}
                  value={s.name}
                  className="cursor-pointer"
                  onSelect={() => toggle(s.id)}
                >
                  <Check
                    className={`mr-1 h-4 w-4 shrink-0 ${sel.has(s.id) ? "opacity-100" : "opacity-0"}`}
                  />
                  <span className="truncate">{s.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-2.5 py-2">
          <span className="text-xs text-slate-400">已选 {sel.size} 个合集</span>
          {pending && (
            <span className="flex items-center gap-1 text-xs text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              保存中…
            </span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** 表格标签列：Popover + Command 多选编辑内容标签；勾选即保存（乐观更新，失败回滚），模式同合集列 */
function TagCell({
  task,
  tagList,
}: {
  task: TaskSummary;
  tagList: Array<{ id: string; name: string }>;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const latestRef = useRef<Set<string>>(new Set());
  const savedRef = useRef<Set<string>>(new Set());
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  function toggle(id: string) {
    const next = new Set(latestRef.current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    latestRef.current = next;
    setSel(next);
    chainRef.current = chainRef.current.then(async () => {
      setPending(true);
      try {
        await api.updateTaskTags(task.taskId, [...latestRef.current]);
        savedRef.current = new Set(latestRef.current);
        void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      } catch (err) {
        latestRef.current = new Set(savedRef.current);
        setSel(new Set(savedRef.current));
        toast.error(err instanceof Error ? err.message : "保存失败");
      } finally {
        setPending(false);
      }
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) {
          const initial = new Set(task.tags.map((t) => t.id));
          setSel(initial);
          latestRef.current = initial;
          savedRef.current = initial;
        }
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title="点击修改内容标签"
          className="-mx-1 cursor-pointer rounded px-1 py-0.5 text-left hover:bg-slate-100"
        >
          {task.tags.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1">
              {task.tags.slice(0, 2).map((t) => (
                <Badge
                  key={t.id}
                  variant="secondary"
                  className="rounded-full px-1.5 py-0 text-[10px]"
                >
                  {t.name}
                </Badge>
              ))}
              {task.tags.length > 2 && (
                <span className="text-[10px] text-slate-400">+{task.tags.length - 2}</span>
              )}
            </span>
          ) : (
            <span className="text-sm whitespace-nowrap text-slate-400">设置</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          <CommandInput placeholder="搜索标签…" />
          <CommandList>
            <CommandEmpty>无匹配标签</CommandEmpty>
            <CommandGroup>
              {tagList.map((t) => (
                <CommandItem
                  key={t.id}
                  value={t.name}
                  className="cursor-pointer"
                  onSelect={() => toggle(t.id)}
                >
                  <Check
                    className={`mr-1 h-4 w-4 shrink-0 ${sel.has(t.id) ? "opacity-100" : "opacity-0"}`}
                  />
                  <span className="truncate">{t.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-2.5 py-2">
          <span className="text-xs text-slate-400">已选 {sel.size} 个标签</span>
          {pending && (
            <span className="flex items-center gap-1 text-xs text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              保存中…
            </span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function TaskList() {
  const search = useUiStore((s) => s.search);
  const openDetail = useUiStore((s) => s.openDetail);
  const openWizard = useUiStore((s) => s.openWizard);
  const modalOpen = useUiStore((s) => s.modal !== null || s.detailTaskId !== null);
  const [sortDesc, setSortDesc] = useState(true);
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<TaskSummary | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ["tasks", search],
    queryFn: () =>
      api.getTasks({
        q: search.q || undefined,
        status: search.status || undefined,
        from: search.from || undefined,
        to: search.to || undefined,
        id: search.id || undefined,
        seriesId: search.seriesId || undefined,
        tagId: search.tagId || undefined,
      }),
    refetchInterval: modalOpen ? false : 4000,
  });

  const { data: seriesData } = useQuery({
    queryKey: ["series"],
    queryFn: () => api.getSeries(),
    retry: false,
  });
  const seriesList = seriesData?.series ?? [];

  const { data: tagsData } = useQuery({
    queryKey: ["tags"],
    queryFn: () => api.getTags(),
    retry: false,
  });
  const tagList = tagsData?.tags ?? [];

  const columns: LegacyColumnDef<TaskSummary>[] = [
    {
      id: "select",
      header: () => (
        <Checkbox
          aria-label="全选"
          checked={allSelected}
          onCheckedChange={(c) =>
            setSelected(
              c === true
                ? new Set([...selected, ...pageIds])
                : new Set([...selected].filter((id) => !pageIds.includes(id))),
            )
          }
          className="size-4"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label="选择任务"
          checked={selected.has(row.original.taskId)}
          onCheckedChange={(c) => {
            const next = new Set(selected);
            if (c === true) next.add(row.original.taskId);
            else next.delete(row.original.taskId);
            setSelected(next);
          }}
          className="size-4"
        />
      ),
    },
    {
      header: "创建时间",
      id: "createdAt",
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-slate-500">
          {formatTime(row.original.createdAt)}
        </span>
      ),
    },
    {
      header: "标题",
      accessorKey: "title",
      cell: ({ row }) => (
        <span className="line-clamp-1 max-w-64 font-medium">
          {row.original.title || "（无标题）"}
        </span>
      ),
    },
    {
      header: "状态",
      id: "status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      header: "来源",
      id: "sourceType",
      cell: ({ row }) => (
        <span className="text-sm text-slate-600">
          {SOURCE_LABELS[row.original.sourceType] ?? row.original.sourceType}
        </span>
      ),
    },
    {
      header: "标签",
      id: "tags",
      cell: ({ row }) => <TagCell task={row.original} tagList={tagList} />,
    },
    {
      header: "合集",
      id: "series",
      cell: ({ row }) => <SeriesCell task={row.original} seriesList={seriesList} />,
    },
    {
      header: "格数",
      id: "imageCnt",
      cell: ({ row }) => <span className="text-sm text-slate-600">{row.original.imageCnt} 张</span>,
    },
    {
      header: "草稿 ID",
      id: "draftMediaId",
      cell: ({ row }) =>
        row.original.draftMediaId ? (
          <button
            type="button"
            title={`点击复制草稿 ID ${row.original.draftMediaId}`}
            onClick={() => void copyDraftId(row.original.draftMediaId!)}
            className="max-w-[110px] truncate rounded bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            {row.original.draftMediaId}
          </button>
        ) : (
          <span className="text-sm text-slate-400">—</span>
        ),
    },
    {
      header: "错误",
      id: "error",
      cell: ({ row }) => {
        const error = row.original.error;
        if (!error) return null;
        const truncated = error.length > 10 ? `${error.slice(0, 10)}…` : error;
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                title={`点击复制错误日志：${error}`}
                onClick={() => void copyText(error, "错误日志已复制")}
                className="line-clamp-1 block max-w-48 cursor-pointer rounded px-1 py-0.5 text-left text-xs text-red-500 hover:bg-red-50 hover:text-red-600"
              >
                {truncated}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs whitespace-pre-wrap">
              {error}
            </TooltipContent>
          </Tooltip>
        );
      },
    },
    {
      header: "操作",
      id: "actions",
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button
            variant="link"
            className="h-auto p-0 text-sm text-blue-600 hover:underline"
            onClick={() => openDetail(row.original.taskId)}
          >
            查看详情
          </Button>
          <Button
            variant="link"
            className="h-auto p-0 text-sm text-emerald-600 hover:underline"
            title="回到工作流当前步骤继续处理"
            onClick={() => openWizard(row.original.taskId)}
          >
            继续
          </Button>
          <Button
            variant="link"
            className="h-auto p-0 text-sm text-blue-600 hover:underline"
            disabled={busy !== null}
            title="基于原任务参数（来源/大纲/题材/类别）新建一条生产任务"
            onClick={() => void copyTask(row.original)}
          >
            复制
          </Button>
          {PROCESSING.includes(row.original.status) && (
            <Button
              variant="link"
              className="h-auto p-0 text-sm text-red-600 hover:underline"
              disabled={busy !== null}
              title="停止在途生成；停止后可删除或继续"
              onClick={() => void stopTask(row.original)}
            >
              停止
            </Button>
          )}
          {row.original.status === "failed" && (
            <Button
              variant="link"
              className="h-auto p-0 text-sm text-blue-600 hover:underline"
              disabled={busy !== null}
              title="仅发布失败的任务可重试"
              onClick={() => void republish(row.original)}
            >
              重试发布
            </Button>
          )}
          {busy !== row.original.taskId &&
            !["collecting", "writing", "drawing", "publishing"].includes(row.original.status) && (
              <Button
                variant="link"
                className="h-auto p-0 text-sm text-red-500 hover:underline"
                onClick={() => setDeleteTarget(row.original)}
              >
                删除
              </Button>
            )}
        </div>
      ),
    },
  ];

  async function copyText(text: string, successMsg: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(successMsg);
    } catch {
      toast.error("复制失败");
    }
  }

  const copyDraftId = (id: string) => copyText(id, "草稿 ID 已复制");

  async function copyTask(task: TaskSummary) {
    setBusy(task.taskId);
    try {
      const r = await api.copyTask(task.taskId);
      toast.success("任务已复制：" + r.taskId);
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "复制失败");
    } finally {
      setBusy(null);
    }
  }

  async function republish(task: TaskSummary) {
    setBusy(task.taskId);
    try {
      const r = await api.publish(task.taskId);
      toast.success("草稿创建成功：" + r.draftMediaId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "发布失败");
    } finally {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    }
  }

  async function stopTask(task: TaskSummary) {
    setBusy(task.taskId);
    try {
      await api.stopTask(task.taskId);
      toast.success("任务已停止");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "停止失败");
    } finally {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(deleteTarget.taskId);
    try {
      const tid = deleteTarget.taskId;
      await api.deleteTask(tid);
      toast.success("任务已删除");
      setDeleteTarget(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(tid);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusy(null);
    }
  }

  async function confirmBulkDelete() {
    if (selected.size === 0) return;
    setBusy("bulk");
    try {
      const r = await api.bulkDeleteTasks([...selected]);
      toast.success(
        `已删除 ${r.deleted.length} 个任务` +
          (r.skipped.length > 0 ? `，${r.skipped.length} 个进行中任务已跳过` : ""),
      );
      setBulkDeleteOpen(false);
      setSelected((prev) => new Set([...prev].filter((id) => !r.deleted.includes(id))));
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批量删除失败");
    } finally {
      setBusy(null);
    }
  }

  const table = useLegacyTable({
    data: data?.tasks ?? [],
    columns,
    getCoreRowModel: getCoreRowModel<TaskSummary>(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting: [{ id: "createdAt", desc: sortDesc }] },
    onSortingChange: (updater) => {
      const next =
        typeof updater === "function" ? updater([{ id: "createdAt", desc: sortDesc }]) : updater;
      const s = next[0];
      setSortDesc(s ? s.desc : !sortDesc);
    },
  });

  const allRows = table.getRowModel().rows;
  const pageCount = Math.max(1, Math.ceil(allRows.length / TASK_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = allRows.slice((currentPage - 1) * TASK_PAGE_SIZE, currentPage * TASK_PAGE_SIZE);
  const pageIds = pageRows.map((r) => r.original.taskId);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  useEffect(() => {
    setPage(1);
  }, [search.q, search.status, search.from, search.to, search.id]);

  return (
    <section className="rounded-xl bg-white shadow-sm">
      {isLoading ? (
        <p className="px-4 py-10 text-center text-sm text-slate-400">加载中…</p>
      ) : error ? (
        <p className="px-4 py-10 text-center text-sm text-red-500">
          加载失败：{error instanceof Error ? error.message : String(error)}
        </p>
      ) : (
        <TooltipProvider>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr
                    key={hg.id}
                    className="border-b border-slate-100 text-xs uppercase text-slate-400"
                  >
                    {hg.headers.map((h) => (
                      <th
                        key={h.id}
                        className={`px-4 py-2 font-medium ${
                          h.id === "createdAt"
                            ? "cursor-pointer select-none hover:text-slate-600"
                            : ""
                        }`}
                        onClick={h.id === "createdAt" ? () => setSortDesc((d) => !d) : undefined}
                      >
                        {h.isPlaceholder
                          ? null
                          : flexRender(h.column.columnDef.header, h.getContext())}
                        {h.id === "createdAt" && (
                          <span className="ml-1">{sortDesc ? "↓" : "↑"}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {allRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      className="px-4 py-10 text-center text-sm text-slate-400"
                    >
                      暂无任务，点右上角「新建生产」开始
                    </td>
                  </tr>
                ) : (
                  pageRows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50">
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-4 py-2.5">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TooltipProvider>
      )}
      {!isLoading && !error && allRows.length > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2">
          <span className="text-sm text-slate-500">
            第 {(currentPage - 1) * TASK_PAGE_SIZE + 1}-
            {Math.min(currentPage * TASK_PAGE_SIZE, allRows.length)} 条，共 {allRows.length} 条
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
            <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>
              取消选择
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy !== null}
              onClick={() => setBulkDeleteOpen(true)}
            >
              批量删除
            </Button>
          </div>
        </div>
      )}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除任务</DialogTitle>
            <DialogDescription>
              确定删除「{deleteTarget?.title || deleteTarget?.taskId}
              」？剧本、图片与发布记录将一并删除，不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() => void confirmDelete()}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={bulkDeleteOpen} onOpenChange={(o) => !o && setBulkDeleteOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>批量删除任务</DialogTitle>
            <DialogDescription>
              确定删除已选的 {selected.size} 个任务？剧本、图片与发布记录将一并删除，不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() => void confirmBulkDelete()}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
