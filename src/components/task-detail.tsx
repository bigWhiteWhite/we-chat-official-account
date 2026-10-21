"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PreviewGroup, PreviewImage } from "@/components/photo-viewer";

import { api, formatTime, imageSrc, type ComicPanelRow } from "@/lib/api";
import { SOURCE_LABELS, statusMeta } from "@/lib/status";
import { useUiStore } from "@/store/ui";

const TERMINAL = ["done", "failed", "rejected"];

const STAGE_LABELS: Record<string, string> = {
  collecting: "选题",
  writing: "剧本",
  subjects: "主体",
  drawing: "生图",
  reviewing: "审核",
  publishing: "发布",
  unknown: "系统",
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </h3>
  );
}

export function TaskDetail({ taskId, embedded = false }: { taskId: string; embedded?: boolean }) {
  const queryClient = useQueryClient();
  const openWizard = useUiStore((s) => s.openWizard);
  const { data: task } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api.getTask(taskId),
    retry: false,
  });

  const isTerminal = task ? TERMINAL.includes(task.status) : false;
  const { data: eventsData } = useQuery({
    queryKey: ["events", taskId],
    queryFn: () => api.getEvents(taskId),
    refetchInterval: isTerminal ? false : 2000,
  });

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDialogues, setEditDialogues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [stopping, setStopping] = useState(false);

  async function copyLog(message: string) {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("日志已复制");
    } catch {
      toast.error("复制失败");
    }
  }

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    void queryClient.invalidateQueries({ queryKey: ["events", taskId] });
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  async function review(action: "pass" | "regenerate" | "reject") {
    try {
      await api.review(taskId, action);
      toast.success(
        action === "pass" ? "已通过审核" : action === "regenerate" ? "已重新提交生图" : "已弃稿",
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function publish() {
    setPublishing(true);
    try {
      const r = await api.publish(taskId);
      toast.success(`已创建公众号草稿（${r.draftMediaId}），请到公众号后台人工发表`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "发布失败");
    } finally {
      setPublishing(false);
    }
  }

  async function stop() {
    setStopping(true);
    try {
      await api.stopTask(taskId);
      toast.success("任务已停止");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "停止失败");
    } finally {
      setStopping(false);
    }
  }

  function openEditor() {
    if (!task?.script) return;
    setEditTitle(task.script.title);
    setEditDialogues(task.script.panels.map((p: ComicPanelRow) => p.dialogue));
    setEditing(true);
  }

  async function saveScript() {
    if (!task?.script) return;
    setSaving(true);
    try {
      const panels = task.script.panels.map((p, i) => ({
        ...p,
        dialogue: (editDialogues[i] ?? "").slice(0, 150),
      }));
      await api.saveScript(taskId, { ...task.script, title: editTitle.slice(0, 32), panels });
      toast.success("剧本已保存");
      setEditing(false);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (!task) {
    return (
      <div className={embedded ? "px-6 py-10" : "mx-auto max-w-5xl"}>
        {!embedded && (
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← 返回任务列表
          </Link>
        )}
        <p className="mt-6 text-center text-sm text-slate-400">加载中…</p>
      </div>
    );
  }

  const meta = statusMeta(task.status);
  const events = eventsData?.events ?? [];
  const images = task.images.filter((p): p is string => p !== null);

  return (
    <div className={embedded ? "px-6 py-8" : "mx-auto max-w-5xl"}>
      {!embedded && (
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← 返回任务列表
        </Link>
      )}

      <header className="mt-4 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">{task.script?.title || "（无标题）"}</h1>
            <p className="mt-1 text-sm text-slate-500">
              来源：{SOURCE_LABELS[task.sourceType] ?? task.sourceType} · 创建时间：
              {formatTime(task.createdAt)}
            </p>
            {(task.tags?.length ?? 0) > 0 && (
              <p className="mt-2 flex flex-wrap items-center gap-1">
                {task.tags!.map((t) => (
                  <Badge
                    key={t.id}
                    variant="secondary"
                    className="rounded-full px-2 py-0.5 text-[11px]"
                    title={t.description || undefined}
                  >
                    {t.name}
                  </Badge>
                ))}
              </p>
            )}
            {task.seriesId && task.series && (
              <Link
                href={`/series/${task.seriesId}`}
                className="mt-2 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
              >
                📚 合集《{task.series.name}》
                {task.episodeNo != null && ` · 第 ${task.episodeNo} 集`}
                {task.carryContext && " · 已带入前情"}
              </Link>
            )}
            {task.script?.punchline && (
              <p className="mt-2 text-sm text-slate-600">爆点：{task.script.punchline}</p>
            )}
            {task.script?.risk_tags && task.script.risk_tags.length > 0 && (
              <div className="mt-2 flex gap-1.5">
                {task.script.risk_tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700"
                  >
                    ⚠ {tag}
                  </span>
                ))}
              </div>
            )}
            {task.draftMediaId && (
              <p className="mt-2 text-sm text-emerald-700">
                草稿 media_id：
                <code className="rounded bg-emerald-50 px-1.5 py-0.5">{task.draftMediaId}</code>
                （请到公众号后台人工发表）
              </p>
            )}
            {task.error && <p className="mt-2 text-sm text-red-600">错误：{task.error}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => openWizard(task.taskId)}
              className="px-3 py-1.5"
            >
              继续工作流
            </Button>
            {["collecting", "writing", "drawing", "publishing"].includes(task.status) && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void stop()}
                disabled={stopping}
                className="px-3 py-1.5"
              >
                {stopping ? "停止中…" : "停止"}
              </Button>
            )}
            <Badge className={`shrink-0 px-3 py-1 text-sm font-medium ${meta.className}`}>
              {meta.spinner && (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
              )}
              {meta.label}
            </Badge>
          </div>
        </div>

        {["reviewing", "review_passed"].includes(task.status) && (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            {task.reviewResult !== "pass" && (
              <Button
                onClick={() => review("pass")}
                className="bg-green-600 px-4 py-2 hover:bg-green-500"
              >
                通过
              </Button>
            )}
            <Button
              onClick={() => review("regenerate")}
              className="bg-blue-600 px-4 py-2 hover:bg-primary"
            >
              重新生图
            </Button>
            {task.reviewResult !== "pass" && (
              <Button variant="secondary" onClick={() => review("reject")} className="px-4 py-2">
                弃稿
              </Button>
            )}
            <Button variant="outline" onClick={openEditor} className="px-4 py-2">
              编辑剧本
            </Button>
            {task.reviewResult === "pass" && !task.draftMediaId && (
              <Button
                onClick={publish}
                disabled={publishing}
                className="ml-auto bg-emerald-600 px-4 py-2 hover:bg-emerald-500"
              >
                {publishing ? "发布中…" : "发布到公众号草稿"}
              </Button>
            )}
          </div>
        )}

        {task.status === "done" && task.draftMediaId && (
          <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            已创建草稿（media_id：{task.draftMediaId}），登录公众号后台 → 草稿箱人工发表。
          </p>
        )}
      </header>

      {task.script && (
        <section className="mt-5 rounded-xl bg-white p-6 shadow-sm">
          <SectionTitle>剧本（{task.script.panels.length} 格）</SectionTitle>
          {editing ? (
            <div className="space-y-3">
              <div>
                <Label className="mb-1 block text-xs text-slate-500">标题（≤32 字）</Label>
                <Input
                  value={editTitle}
                  maxLength={32}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="py-1.5"
                />
              </div>
              {task.script.panels.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-10 shrink-0 text-xs text-slate-400">第{i + 1}格</span>
                  <Input
                    value={editDialogues[i] ?? ""}
                    maxLength={300}
                    onChange={(e) => {
                      const next = [...editDialogues];
                      next[i] = e.target.value;
                      setEditDialogues(next);
                    }}
                    className="flex-1 py-1.5"
                  />
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <Button onClick={saveScript} disabled={saving} className="px-4 py-2">
                  {saving ? "保存中…" : "保存"}
                </Button>
                <Button variant="outline" onClick={() => setEditing(false)} className="px-4 py-2">
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {task.script.panels.map((p, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs text-slate-400">
                    第{i + 1}格 · {p.character}
                  </p>
                  <p className="mt-1 text-sm text-slate-700">{p.scene}</p>
                  <p className="mt-1.5 rounded bg-slate-50 px-2 py-1 text-sm text-slate-900">
                    「{p.dialogue}」
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {task.references && (
        <section className="mt-5 rounded-xl bg-white p-6 shadow-sm">
          <SectionTitle>主体参考</SectionTitle>
          {Array.isArray((task.references as { characters?: unknown[] }).characters) ? (
            (() => {
              const refs = task.references as {
                style?: { assetId: string | null; preset: string; image: string | null };
                scene: { assetId: string | null; name: string; image: string | null };
                characters: Array<{ name: string; assetId: string | null; image: string | null }>;
              };
              return (
                <div className="space-y-3">
                  {refs.style && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-medium text-slate-500">画风</span>
                      {refs.style.image && (
                        <PreviewImage
                          src={imageSrc(refs.style.image)}
                          alt="画风"
                          className="h-12 w-12 rounded object-cover"
                        />
                      )}
                      <span className="text-sm text-slate-700">{refs.style.preset}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3">
                    {refs.scene.image && (
                      <figure className="w-24">
                        <PreviewImage
                          src={imageSrc(refs.scene.image)}
                          alt={refs.scene.name}
                          className="h-24 w-24 rounded-lg border border-slate-200 object-cover"
                        />
                        <figcaption className="mt-1 truncate text-xs text-slate-500">
                          场景 · {refs.scene.name}
                        </figcaption>
                      </figure>
                    )}
                    {refs.characters.map((c, i) =>
                      c.image ? (
                        <figure key={i} className="w-24">
                          <PreviewImage
                            src={imageSrc(c.image)}
                            alt={c.name}
                            className="h-24 w-24 rounded-lg border border-slate-200 object-cover"
                          />
                          <figcaption className="mt-1 truncate text-xs text-slate-500">
                            角色 · {c.name}
                          </figcaption>
                        </figure>
                      ) : null,
                    )}
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="flex gap-3">
              {(["character", "scene"] as const).map((slot) => {
                const p = (task.references as Record<string, string>)[slot];
                return p ? (
                  <figure key={slot} className="w-24">
                    <PreviewImage
                      src={imageSrc(p)}
                      alt={slot}
                      className="h-24 w-24 rounded-lg border border-slate-200 object-cover"
                    />
                    <figcaption className="mt-1 text-xs text-slate-500">
                      {slot === "character" ? "角色参考" : "场景参考"}
                    </figcaption>
                  </figure>
                ) : null;
              })}
            </div>
          )}
        </section>
      )}

      {images.length > 0 && (
        <section className="mt-5 rounded-xl bg-white p-6 shadow-sm">
          <SectionTitle>分图（{images.length} 张）</SectionTitle>
          <PreviewGroup>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {images.map((p, i) => (
                <div key={i} className="overflow-hidden rounded-lg border border-slate-200">
                  <PreviewImage
                    src={imageSrc(p)}
                    alt={`第 ${i + 1} 张`}
                    className="w-full object-cover"
                    loading="lazy"
                  />
                </div>
              ))}
            </div>
          </PreviewGroup>
        </section>
      )}

      <section className="mt-5 rounded-xl bg-white p-6 shadow-sm">
        <SectionTitle>执行日志</SectionTitle>
        {events.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">暂无日志</p>
        ) : (
          <ol className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 w-14 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-center text-xs text-slate-500">
                  {STAGE_LABELS[e.stage] ?? e.stage}
                </span>
                <span className="w-28 shrink-0 text-xs text-slate-400">
                  {formatTime(e.createdAt)}
                </span>
                <span className="shrink-0 font-mono text-xs text-slate-500">{e.eventType}</span>
                <button
                  type="button"
                  onClick={() => void copyLog(e.message)}
                  title="点击复制日志"
                  className="min-w-0 cursor-pointer break-all rounded px-1 text-left text-slate-700 hover:bg-slate-100"
                >
                  {e.message}
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
