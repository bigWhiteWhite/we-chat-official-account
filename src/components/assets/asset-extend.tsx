"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AiFeed } from "@/components/ai-feed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { PreviewImage } from "@/components/photo-viewer";
import { api, imageSrc, type AssetSummary } from "@/lib/api";
import { useAiStream } from "@/lib/use-ai-stream";

const ROLE_OPTIONS = [
  { value: "member", label: "普通成员" },
  { value: "protagonist", label: "常驻主角" },
] as const;

type SeriesRole = (typeof ROLE_OPTIONS)[number]["value"];

/**
 * 主体扩展弹窗：基于基准主体 + 用户指令，LLM 创作新主体设定（含人设三字段），
 * img2img 生成新图并入库。可选指定目标合集（画风锁定 + 自动关联）。
 */
export function AssetExtend({ asset, onClose }: { asset: AssetSummary; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [hint, setHint] = useState("");
  const [doneImage, setDoneImage] = useState<string | null>(null);
  const [seriesId, setSeriesId] = useState(asset.seriesLinks[0]?.seriesId ?? "");
  const [seriesRole, setSeriesRole] = useState<SeriesRole>("member");

  const { data: seriesData } = useQuery({
    queryKey: ["series"],
    queryFn: () => api.getSeries(),
    enabled: asset.type === "character" || asset.type === "scene",
  });
  const seriesList = seriesData?.series ?? [];
  const selectedSeries = seriesList.find((s) => s.id === seriesId) ?? null;

  const {
    items,
    streaming: running,
    start,
    reset,
    abort,
    push,
  } = useAiStream({
    doneLabel: "新资产已入库",
    onError: (message) => toast.error(message || "扩展失败"),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void queryClient.invalidateQueries({ queryKey: ["series"] });
    },
    onEvent: (ev) => {
      if (ev.type === "profile") {
        const lines = [`新主体：${String(ev.name)}`];
        if (ev.characterProfile) lines.push(`人物设定：${String(ev.characterProfile)}`);
        if (ev.personality) lines.push(`性格：${String(ev.personality)}`);
        if (ev.traits) lines.push(`专属小特点：${String(ev.traits)}`);
        lines.push(`外观设定：${String(ev.appearance)}`);
        lines.push(`关键词：${String(ev.keywords)}`);
        push({ type: "text", text: lines.join("\n"), live: false });
        return true;
      }
      if (ev.type === "done") {
        setDoneImage(ev.image ? String(ev.image) : null);
        if (ev.seriesName) {
          const roleLabel =
            ev.seriesRole === "protagonist"
              ? "常驻主角"
              : ev.seriesRole === "scene"
                ? "常设场景"
                : "普通成员";
          toast.success(`已加入合集「${String(ev.seriesName)}」（${roleLabel}）`);
        }
      }
      return false;
    },
  });

  const typeLabel = asset.type === "character" ? "角色" : "场景";

  function run() {
    if (running || !hint.trim()) return;
    setDoneImage(null);
    reset();
    void start(`/api/assets/${asset.id}/extend`, {
      userHint: hint.trim(),
      seriesId: seriesId || null,
      seriesRole: seriesId ? (asset.type === "scene" ? "scene" : seriesRole) : undefined,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold">扩展{typeLabel}主体</h3>
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
          {asset.primaryImage ? (
            <PreviewImage
              src={imageSrc(asset.primaryImage)}
              alt={asset.name}
              className="h-16 w-16 rounded-sm border border-slate-200 object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-md bg-slate-100 text-xs text-slate-400">
              无图
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800">{asset.name}</p>
            <p className="line-clamp-2 text-xs text-slate-500">
              {asset.variants[0]?.appearance || "（无外观设定）"}
            </p>
          </div>
        </div>

        {(asset.type === "character" || asset.type === "scene") && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
              <div>
                <p className="mb-1 text-sm font-medium text-slate-600">
                  目标合集 <span className="font-normal text-slate-400">（可选）</span>
                </p>
                <Select
                  value={seriesId || "none"}
                  onValueChange={(v) => setSeriesId(v === "none" ? "" : v)}
                  disabled={running}
                >
                  <SelectTrigger className="h-8 w-full">
                    <SelectValue placeholder="不加入合集（独立资产）" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不加入合集（独立资产）</SelectItem>
                    {seriesList.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} · 画风：{s.styleName ?? "未设置"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedSeries && asset.type === "character" && (
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-600">合集内身份</p>
                  <Select
                    value={seriesRole}
                    onValueChange={(v) => setSeriesRole(v as SeriesRole)}
                    disabled={running}
                  >
                    <SelectTrigger className="h-8 w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {selectedSeries && asset.type === "scene" && (
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-600">合集内身份</p>
                  <span className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
                    常设场景
                  </span>
                </div>
              )}
            </div>
            {selectedSeries && (
              <div className="flex items-center gap-3 rounded-lg border border-amber-100 bg-amber-50/60 p-2.5">
                {selectedSeries.styleImage ? (
                  <PreviewImage
                    src={imageSrc(selectedSeries.styleImage)}
                    alt={selectedSeries.styleName ?? "画风"}
                    className="h-10 w-10 rounded-sm border border-amber-200 object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-amber-100 text-[10px] text-amber-500">
                    无图
                  </div>
                )}
                <p className="text-xs text-amber-700">
                  画风已锁定：
                  <span className="font-medium">{selectedSeries.styleName ?? "未设置"}</span>
                  {selectedSeries.styleImage
                    ? "（将作为生图参考）"
                    : "（无画风图，将沿用原主体图）"}
                </p>
              </div>
            )}
            {selectedSeries && seriesRole === "protagonist" && (
              <p className="text-xs text-amber-600">
                选为常驻主角后，该角色将进入合集固定阵容，每集默认出场。
              </p>
            )}
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <Input
            value={hint}
            onChange={(e) => setHint(e.target.value.slice(0, 200))}
            placeholder={
              asset.type === "scene"
                ? `如：根据 ${asset.name} 生成同风格变体场景，保留画风`
                : `如：根据 ${asset.name} 生成小龙女，保留画风，气质清冷`
            }
            className="flex-1"
          />
          <Button
            onClick={() => void run()}
            disabled={running || !hint.trim()}
            className="px-4 py-2"
          >
            {running ? "生成中…" : "生成"}
          </Button>
        </div>
        <div className="mt-3 min-h-40 flex-1 overflow-hidden">
          <AiFeed items={items} />
        </div>
        {doneImage && (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
            <PreviewImage
              src={imageSrc(doneImage)}
              alt="新资产"
              className="h-14 w-14 rounded-sm border border-emerald-200 object-cover"
            />
            <p className="text-sm text-emerald-700">新资产已入库，可在资产列表中查看</p>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          {running && (
            <Button variant="outline" onClick={abort} className="px-4 py-2">
              停止
            </Button>
          )}
          <Button variant="outline" onClick={onClose} className="px-4 py-2">
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
}
