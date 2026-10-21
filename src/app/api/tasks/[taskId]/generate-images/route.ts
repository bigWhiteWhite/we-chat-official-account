import { NextResponse } from "next/server";
import path from "node:path";

import { db } from "@/lib/db";
import { getStylePreset } from "@/lib/business-settings";
import { hasAnyRun, registerRun, unregisterRun } from "@/lib/inflight";
import { createSseStream } from "@/lib/sse";
import { logTaskEvent } from "@/lib/task-events";
import { drawPanels } from "@/pipeline/artist";
import { buildPanelRefs, parseTaskReferences, stylePresetFor } from "@/pipeline/subjects";
import type { ComicScript } from "@/pipeline/schema";

/** SSE：对所有分格并行图生图（并发 2，按格取参考图）；逐格增量落库，前端生成一张显示一张；全成→reviewing，有败→drawing。 */
export async function POST(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const body = (await req.json().catch(() => ({}))) as { layout?: string };
  const layout = body.layout || "wide";
  if (hasAnyRun(taskId)) {
    return NextResponse.json({ error: "该任务有生成任务进行中，请稍候" }, { status: 409 });
  }
  const task = await db.task.findUnique({ where: { taskId } });
  if (!task) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!task.scriptJson) {
    return NextResponse.json({ error: "任务暂无剧本" }, { status: 400 });
  }
  const script = JSON.parse(task.scriptJson) as ComicScript;
  const parsed = parseTaskReferences(task.referencePathsJson);
  if (parsed.kind === "none") {
    return NextResponse.json({ error: "缺少主体数据，请先确认主体" }, { status: 400 });
  }
  const scriptForDraw = script;
  const refForPanel = (i: number) =>
    parsed.kind === "new"
      ? buildPanelRefs(script, parsed.refs, i)
      : Object.values(parsed.paths).filter(Boolean);
  const preset = stylePresetFor(parsed.kind === "new" ? parsed.refs : null, getStylePreset());
  const outDir = path.join("data", "images", taskId);

  const controller = new AbortController();
  registerRun(taskId, controller);

  /** 断点续传：保留已生成格（如手动停止后重新生成），仅补生成缺失格 */
  let existingImages: (string | null)[] = [];
  if (task.imagePathsJson) {
    try {
      const arr = JSON.parse(task.imagePathsJson) as (string | null)[];
      if (Array.isArray(arr)) existingImages = arr;
    } catch {
      existingImages = [];
    }
  }

  /** 逐格增量落库（串行化写，防并发覆盖），前端轮询/SSE 刷新即可实时看到已生成格 */
  const results: (string | null)[] = script.panels.map((_, i) => existingImages[i] ?? null);
  const keptCount = results.filter(Boolean).length;
  let persistChain: Promise<void> = Promise.resolve();
  const persistImages = (): void => {
    persistChain = persistChain.then(async () => {
      await db.task.update({
        where: { taskId },
        data: {
          imagePathsJson: JSON.stringify(results),
          imageCnt: results.filter(Boolean).length,
        },
      });
    });
  };

  return createSseStream(async (send) => {
    try {
      await db.task.update({ where: { taskId }, data: { status: "drawing" } });
      const toDraw = script.panels.length - keptCount;
      send({
        type: "stage",
        message:
          keptCount > 0
            ? `已有 ${keptCount} 格，补生成剩余 ${toDraw} 格…`
            : `正在生成 ${script.panels.length} 格分格图…`,
      });
      await logTaskEvent(
        taskId,
        "drawing",
        "draw_start",
        keptCount > 0
          ? `补生成 ${toDraw} 格（保留 ${keptCount} 格）`
          : `${script.panels.length} 格`,
      );
      if (keptCount > 0) {
        results.forEach((p, i) => {
          if (p) send({ type: "panel", index: i, path: p });
        });
      }
      try {
        const out = await drawPanels(
          scriptForDraw,
          outDir,
          refForPanel,
          (index, r) => {
            if (r.path) results[index] = r.path;
            void persistImages();
            if (controller.signal.aborted) return;
            if (r.path) {
              send({ type: "panel", index, path: r.path });
              void logTaskEvent(taskId, "drawing", "panel_done", r.path, { index });
            } else {
              send({ type: "panel-error", index, message: r.error ?? "生成失败" });
              void logTaskEvent(taskId, "drawing", "panel_failed", r.error ?? "生成失败", {
                index,
              });
            }
          },
          preset,
          controller.signal,
          results.slice(),
          layout,
        );

        await persistChain;
        const failedCount = out.filter((p) => p === null).length;
        const status = failedCount === 0 ? "reviewing" : "drawing";
        await db.task.update({
          where: { taskId },
          data: {
            layout,
            imagePathsJson: JSON.stringify(out),
            imageCnt: out.length - failedCount,
            status,
          },
        });
        send({ type: "done", status, failedCount });
        await logTaskEvent(
          taskId,
          "drawing",
          "draw_done",
          `${out.length - failedCount}/${out.length} 成功`,
          {
            failedCount,
          },
        );
      } catch (err) {
        if (controller.signal.aborted) {
          // 手动停止：status 已由停止接口置为 stopped，保留已落库的部分结果
          send({ type: "done", status: "stopped", failedCount: 0 });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        await db.task.update({ where: { taskId }, data: { status: "failed", error: message } });
        await logTaskEvent(taskId, "drawing", "task_failed", message);
        throw err;
      }
    } finally {
      unregisterRun(taskId);
    }
  });
}
