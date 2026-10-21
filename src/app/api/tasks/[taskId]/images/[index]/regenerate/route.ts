import { NextResponse } from "next/server";
import path from "node:path";

import pRetry from "p-retry";

import { db } from "@/lib/db";
import { getNarrationInImage, getStylePreset } from "@/lib/business-settings";
import { isRunning, panelRunKey, registerRun, unregisterRun } from "@/lib/inflight";
import { logTaskEvent } from "@/lib/task-events";
import { callImageEdits } from "@/pipeline/artist";
import { nextPanelPath } from "@/pipeline/panel-versions";
import { buildPanelPrompt } from "@/pipeline/prompts/panel";
import { buildPanelRefs, parseTaskReferences, stylePresetFor } from "@/pipeline/subjects";
import { savePanelImage } from "@/pipeline/panels";
import type { ComicScript } from "@/pipeline/schema";

/** 单格重生成：图生图（带该格参考图），覆盖对齐位；全部补齐后进入 reviewing。 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ taskId: string; index: string }> },
) {
  const { taskId, index: rawIndex } = await params;
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "格序号无效" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { layout?: string };
  const task = await db.task.findUnique({ where: { taskId } });
  if (!task) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!task.scriptJson || !task.referencePathsJson) {
    return NextResponse.json({ error: "缺少剧本或主体数据，无法重生成" }, { status: 400 });
  }

  const script = JSON.parse(task.scriptJson) as ComicScript;
  if (index >= script.panels.length) {
    return NextResponse.json({ error: "格序号越界" }, { status: 400 });
  }
  const panelKey = panelRunKey(taskId, index);
  if (isRunning(panelKey)) {
    return NextResponse.json({ error: "该格正在生成中，请稍候" }, { status: 409 });
  }
  // 仅与主流程（剧本/批量生图）互斥；其他单格在途不影响，多格可并行
  if (isRunning(taskId)) {
    return NextResponse.json({ error: "主流程（剧本/批量生图）进行中，请稍候" }, { status: 409 });
  }
  const parsed = parseTaskReferences(task.referencePathsJson);
  if (parsed.kind === "none") {
    return NextResponse.json({ error: "缺少主体数据" }, { status: 400 });
  }
  const refPaths =
    parsed.kind === "new"
      ? buildPanelRefs(script, parsed.refs, index)
      : Object.values(parsed.paths).filter(Boolean);
  if (refPaths.length === 0) {
    return NextResponse.json({ error: "无可用参考图" }, { status: 400 });
  }
  const preset = stylePresetFor(parsed.kind === "new" ? parsed.refs : null, getStylePreset());
  // 前端当前布局优先，缺省回退任务已存布局
  const layout =
    (body.layout === "tall" || body.layout === "wide" ? body.layout : task.layout) ?? "wide";
  const panelScript = script;

  // 版本化写入：新文件 panel-NN.vN.png，旧版本保留在磁盘，DB 指针由 savePanelImage 切换
  const outPath = await nextPanelPath(path.join("data", "images", taskId), index);
  const controller = new AbortController();
  registerRun(panelKey, controller);
  try {
    const img = await pRetry(
      () =>
        callImageEdits(
          buildPanelPrompt(
            panelScript,
            script.panels[index],
            index,
            preset,
            layout,
            getNarrationInImage(),
          ),
          refPaths,
          outPath,
          controller.signal,
        ),
      { retries: 2 },
    );
    // 多格并行重生成会同时回写 imagePathsJson：savePanelImage 在进程内串行重读最新值再写，防互相覆盖
    const { status } = await savePanelImage(taskId, index, img.path, script.panels.length);
    await logTaskEvent(taskId, "drawing", "panel_regenerated", img.path, { index });
    return NextResponse.json({ path: img.path, status });
  } catch (err) {
    if (controller.signal.aborted) {
      return NextResponse.json({ error: "已停止" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : String(err);
    await logTaskEvent(taskId, "drawing", "panel_failed", message, { index });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    unregisterRun(panelKey);
  }
}
