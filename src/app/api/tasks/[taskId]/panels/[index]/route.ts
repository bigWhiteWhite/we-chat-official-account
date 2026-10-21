import { rm } from "node:fs/promises";

import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { logTaskEvent } from "@/lib/task-events";
import { removePanelAt } from "@/pipeline/panels";

/** 删除某一格：剧本与图片路径按下标同步删除；图片文件尽力删除（孤儿文件无害）。 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ taskId: string; index: string }> },
) {
  const { taskId, index: rawIndex } = await params;
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "格序号无效" }, { status: 400 });
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
    next = removePanelAt(task.scriptJson, task.imagePathsJson, index);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
  const oldPaths = task.imagePathsJson
    ? (JSON.parse(task.imagePathsJson) as (string | null)[])
    : [];
  const removedPath = oldPaths[index];
  if (removedPath) {
    rm(removedPath, { force: true }).catch(() => {});
  }
  const newPaths = next.imagePathsJson
    ? (JSON.parse(next.imagePathsJson) as (string | null)[])
    : [];
  await db.task.update({
    where: { taskId },
    data: {
      scriptJson: next.scriptJson,
      imagePathsJson: next.imagePathsJson,
      imageCnt: newPaths.filter(Boolean).length,
    },
  });
  await logTaskEvent(taskId, "drawing", "panel_deleted", String(index), { index });
  return NextResponse.json({ ok: true });
}
