"use client";

import { useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { api, formatTime, imageSrc, type PanelVersionInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

function versionLabel(version: number): string {
  return version === 0 ? "初始版本" : `v${version}`;
}

/**
 * 分格图版本选择弹窗：列出该格磁盘上的全部版本，点卡片切换当前版本（仅移动 DB 指针，磁盘版本全保留）。
 * 缩略图用原生 img 而非 PreviewImage：这里的点击语义是"选中该版本"，
 * PreviewImage 会抢占点击打开灯箱，切换选中需单独按钮，交互反复杂。
 */
export function PanelVersionDialog({
  taskId,
  index,
  onClose,
}: {
  taskId: string;
  index: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selecting, setSelecting] = useState<string | null>(null);
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["panel-versions", taskId, index],
    queryFn: () => api.getPanelVersions(taskId, index),
    retry: false,
  });
  const versions = data?.versions ?? [];

  async function pick(v: PanelVersionInfo) {
    if (v.isActive || selecting) return;
    setSelecting(v.path);
    try {
      await api.selectPanelVersion(taskId, index, v.path);
      toast.success(`第 ${index + 1} 格已切换到 ${versionLabel(v.version)}`);
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "切换版本失败");
      setSelecting(null);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>第 {index + 1} 格图片版本</DialogTitle>
          <DialogDescription>
            点击卡片将该格切换到对应版本；旧版本保留在磁盘，可随时切回。
          </DialogDescription>
        </DialogHeader>
        {isPending ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
            <Spinner />
            加载版本中…
          </div>
        ) : isError ? (
          <p className="py-6 text-center text-sm text-red-500">
            {error instanceof Error ? error.message : "版本列表加载失败"}
          </p>
        ) : versions.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">该格还没有版本文件</p>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {versions.map((v) => (
              <div
                key={v.path}
                role="button"
                tabIndex={0}
                aria-label={`切换到${versionLabel(v.version)}`}
                onClick={() => void pick(v)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void pick(v);
                  }
                }}
                className={cn(
                  "cursor-pointer overflow-hidden rounded-md border bg-white text-left transition-shadow",
                  v.isActive
                    ? "border-primary ring-1 ring-primary"
                    : "border-slate-200 hover:shadow-md",
                  selecting && selecting !== v.path && "opacity-60",
                )}
              >
                <div className="flex aspect-square items-center justify-center bg-slate-50">
                  <img
                    src={imageSrc(v.path)}
                    alt={versionLabel(v.version)}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                  <span className="text-xs font-medium text-slate-700">
                    {versionLabel(v.version)}
                  </span>
                  {v.isActive ? (
                    <Badge variant="outline" className="h-5 gap-0.5 px-1.5 text-[10px]">
                      <Check className="h-3 w-3" />
                      当前
                    </Badge>
                  ) : (
                    <span className="text-[10px] text-slate-400">{formatTime(v.updatedAt)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          {selecting && (
            <span className="mr-auto flex items-center gap-2 text-xs text-slate-500">
              <Spinner />
              切换中…
            </span>
          )}
          <Button variant="outline" onClick={onClose} disabled={!!selecting}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
