"use client";

import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { PreviewImage } from "@/components/photo-viewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SeriesFormDialog } from "@/components/series/series-form-dialog";
import { api, formatTime, imageSrc, type SeriesEpisode, type SeriesSummary } from "@/lib/api";
import { statusMeta } from "@/lib/status";
import { useUiStore } from "@/store/ui";

function EpisodeStatusBadge({ status }: { status: string }) {
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

/** 合集详情页：头部信息 + 主角展示 + 剧集列表（可编辑本集简介） */
export function SeriesDetail({ seriesId }: { seriesId: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const openWizard = useUiStore((s) => s.openWizard);
  const openDetail = useUiStore((s) => s.openDetail);
  const [editOpen, setEditOpen] = useState(false);
  const [digestEdit, setDigestEdit] = useState<{ taskId: string; value: string } | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["series", seriesId],
    queryFn: () => api.getSeriesDetail(seriesId),
    retry: false,
  });

  const statusMut = useMutation({
    mutationFn: (s: SeriesSummary) =>
      api.updateSeries(s.id, { status: s.status === "ongoing" ? "finished" : "ongoing" }),
    onSuccess: (s) => {
      toast.success(s.series.status === "ongoing" ? "已恢复连载" : "已标记完结");
      refetch();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "操作失败"),
  });

  async function saveDigest() {
    if (!digestEdit) return;
    try {
      await api.updateEpisodeDigest(digestEdit.taskId, digestEdit.value.trim());
      toast.success("本集简介已更新");
      setDigestEdit(null);
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    }
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const { series, episodes } = data;
  const ongoing = series.status === "ongoing";

  return (
    <div>
      {/* 头部 */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-4">
          {(series.coverPath || series.styleImage) && (
            <PreviewImage
              src={imageSrc(series.coverPath ?? series.styleImage!)}
              alt={series.name}
              className="h-20 w-20 shrink-0 rounded-lg border border-slate-200 object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-bold text-slate-900">{series.name}</h1>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                  ongoing ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
                }`}
              >
                {ongoing ? "连载中" : "已完结"}
              </span>
            </div>
            {series.intro && (
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{series.intro}</p>
            )}
            {series.tags.length > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                标签：{series.tags.map((t) => t.name).join(" · ")}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-400">
              {series.episodeCount} 集 · 画风：
              {series.styles.map((s) => s.name).join("、") || "未设"} · 更新于{" "}
              {formatTime(series.updatedAt)}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                useUiStore.getState().setSearch({ seriesId });
                router.push("/");
              }}
              className="px-3 text-xs"
            >
              查看任务
            </Button>
            <Button
              variant="ghost"
              onClick={() => router.push(`/assets?seriesId=${seriesId}`)}
              className="px-3 text-xs"
            >
              查看资产
            </Button>
            <Button variant="outline" onClick={() => setEditOpen(true)} className="px-3">
              编辑
            </Button>
            <Button
              variant={ongoing ? "outline" : "secondary"}
              disabled={statusMut.isPending}
              onClick={() => statusMut.mutate(series)}
              className="px-3"
            >
              {ongoing ? "标记完结" : "恢复连载"}
            </Button>
            <Button
              onClick={() => openWizard(undefined, series.id)}
              disabled={!ongoing}
              className="px-4"
            >
              <Plus className="h-4 w-4" />
              创建新一集
            </Button>
          </div>
        </div>

        {/* 主角 */}
        {series.protagonists.length > 0 && (
          <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4">
            <span className="text-xs font-medium text-slate-400">主角</span>
            <div className="flex flex-wrap gap-3">
              {series.protagonists.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-1.5"
                  title={p.imagePrompt || p.name}
                >
                  {p.image && (
                    <PreviewImage
                      src={imageSrc(p.image)}
                      alt={p.name}
                      className="h-9 w-9 rounded-full border border-slate-200 object-cover"
                    />
                  )}
                  <span className="text-sm text-slate-700">{p.name}</span>
                </div>
              ))}
            </div>
            <span className="ml-auto text-xs text-slate-400">
              主角与画风均可在「编辑」中增删；剧集创建时选择本集画风（默认第一个）
            </span>
          </div>
        )}
        {series.members.length > 0 && (
          <div className="mt-3 flex items-center gap-3 border-t border-slate-100 pt-3">
            <span className="text-xs font-medium text-slate-400">其他成员</span>
            <div className="flex flex-wrap gap-3">
              {series.members.map((m) => (
                <div key={m.id} className="flex items-center gap-1.5" title={m.name}>
                  {m.image && (
                    <PreviewImage
                      src={imageSrc(m.image)}
                      alt={m.name}
                      className="h-7 w-7 rounded-full border border-slate-200 object-cover"
                    />
                  )}
                  <span className="text-sm text-slate-700">{m.name}</span>
                </div>
              ))}
            </div>
            <span className="ml-auto text-xs text-slate-400">成员仅归档，不锁定出场</span>
          </div>
        )}
      </div>

      {/* 剧集列表 */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-700">剧集（{episodes.length}）</h2>
        </div>
        {episodes.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-slate-400">还没有剧集，点右上角「创建新一集」开始连载</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
                <th className="px-5 py-2 font-medium">集数</th>
                <th className="px-3 py-2 font-medium">标题</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">本集简介</th>
                <th className="px-3 py-2 font-medium">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {episodes.map((ep: SeriesEpisode) => (
                <tr key={ep.taskId} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-5 py-2.5 text-slate-500">第 {ep.episodeNo ?? "?"} 集</td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      className="flex items-center gap-2 text-left font-medium text-slate-800 hover:text-slate-950 hover:underline cursor-pointer"
                      onClick={() => openDetail(ep.taskId)}
                    >
                      {ep.cover && (
                        <PreviewImage
                          src={imageSrc(ep.cover)}
                          alt=""
                          className="h-8 w-8 shrink-0 rounded border border-slate-200 object-cover"
                        />
                      )}
                      <span className="max-w-52 truncate">{ep.title}</span>
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <EpisodeStatusBadge status={ep.status} />
                  </td>
                  <td className="max-w-72 px-3 py-2.5">
                    {digestEdit?.taskId === ep.taskId ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={digestEdit.value}
                          onChange={(e) =>
                            setDigestEdit({ taskId: ep.taskId, value: e.target.value })
                          }
                          maxLength={120}
                          className="h-8 text-xs"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          onClick={() => void saveDigest()}
                          className="h-8 px-2 text-xs"
                        >
                          保存
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDigestEdit(null)}
                          className="h-8 px-2 text-xs"
                        >
                          取消
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-start gap-1.5">
                        <span className="line-clamp-2 flex-1 text-xs text-slate-500">
                          {ep.digest || (
                            <span className="text-slate-300">（发布后自动生成，可手动编辑）</span>
                          )}
                        </span>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="shrink-0 text-slate-400 hover:text-slate-600"
                          onClick={() => setDigestEdit({ taskId: ep.taskId, value: ep.digest })}
                          aria-label="编辑简介"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-400">{formatTime(ep.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <SeriesFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        series={series}
        onSaved={() => {
          refetch();
          void queryClient.invalidateQueries({ queryKey: ["series"] });
        }}
      />
    </div>
  );
}
