import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { abortRun } from "@/lib/inflight";
import { logTaskEvent } from "@/lib/task-events";

const PROCESSING = ["collecting", "writing", "drawing", "publishing"];

/**
 * 停止任务：
 * - 有在途生成（剧本/分格图）→ abort 中断 API 调用，已落库的部分结果保留；
 * - 无在途（如服务重启后状态卡死）→ 直接置为 stopped，任务即可删除、可继续。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const task = await db.task.findUnique({ where: { taskId } });
  if (!task) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!PROCESSING.includes(task.status)) {
    return NextResponse.json({ error: "任务未在运行中，无需停止" }, { status: 400 });
  }
  const aborted = abortRun(taskId);
  await db.task.update({
    where: { taskId },
    data: { status: "stopped", error: "任务已手动停止" },
  });
  await logTaskEvent(
    taskId,
    "unknown",
    "task_stopped",
    aborted ? "已中断在途生成" : "无在途生成，直接置为已停止",
  );
  return NextResponse.json({ ok: true, aborted });
}
