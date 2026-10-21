import { NextResponse } from "next/server";

import { z } from "zod";

import { db } from "@/lib/db";
import { logTaskEvent } from "@/lib/task-events";
import { reorderPanels } from "@/pipeline/panels";

const Body = z.object({
  from: z.number().int().min(0),
  to: z.number().int().min(0),
});

/** 格口拖拽排序：同步移动 scriptJson.panels 与 imagePathsJson 保持下标对齐 */
export async function POST(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const task = await db.task.findUnique({ where: { taskId } });
  if (!task) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!task.scriptJson) {
    return NextResponse.json({ error: "任务暂无剧本" }, { status: 400 });
  }
  let next: { scriptJson: string; imagePathsJson: string | null };
  try {
    next = reorderPanels(task.scriptJson, task.imagePathsJson, parsed.data.from, parsed.data.to);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
  await db.task.update({
    where: { taskId },
    data: { scriptJson: next.scriptJson, imagePathsJson: next.imagePathsJson },
  });
  await logTaskEvent(
    taskId,
    "drawing",
    "panels_reordered",
    `${parsed.data.from}->${parsed.data.to}`,
    {
      from: parsed.data.from,
      to: parsed.data.to,
    },
  );
  return NextResponse.json({ ok: true });
}
