import { cp } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { logTaskEvent } from "@/lib/task-events";

/** 进行中的状态复制时映射到最近的稳定状态，副本可从对应步骤继续。 */
const PROCESSING_TO_STABLE: Record<string, string> = {
  collecting: "collecting",
  writing: "collecting",
  drawing: "subjects_ready",
  publishing: "reviewing",
};

/**
 * 复制任务（完整复制）：携带大纲/剧本/主体绑定/图片等全部步骤数据；
 * 同步复制本地图像目录并把路径字段中的旧任务 id 改写为新 id。
 * 草稿属于原任务（微信草稿箱），副本从空草稿开始，可重新发布。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const src = await db.task.findUnique({
    where: { taskId },
    include: { tags: { select: { tagId: true } } },
  });
  if (!src) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const status = PROCESSING_TO_STABLE[src.status] ?? src.status;
  const task = await db.task.create({
    data: {
      status,
      sourceType: src.sourceType,
      outlineText: src.outlineText,
      title: src.title,
      referencePathsJson: src.referencePathsJson,
      subjectBindingsJson: src.subjectBindingsJson,
      scriptJson: src.scriptJson,
      imagePathsJson: src.imagePathsJson,
      reviewResult: src.reviewResult,
      reviewNote: src.reviewNote,
      imageCnt: src.imageCnt,
      costLlmUsd: src.costLlmUsd,
      tags: { create: src.tags.map((x) => ({ tagId: x.tagId })) },
    },
  });

  // 复制图片目录，并把路径字段中的旧任务 id 改写为新 id
  const oldDir = path.join("data", "images", src.taskId);
  const newDir = path.join("data", "images", task.taskId);
  const rewrite = (v: string | null) => (v ? v.split(src.taskId).join(task.taskId) : null);
  const newImagePaths = rewrite(src.imagePathsJson);
  const newReferences = rewrite(src.referencePathsJson);
  let copiedImages = false;
  try {
    await cp(oldDir, newDir, { recursive: true });
    copiedImages = true;
  } catch {
    // 无本地图像目录（该任务尚无图片或已被清理），保留原路径引用
  }
  if (copiedImages) {
    await db.task.update({
      where: { taskId: task.taskId },
      data: {
        imagePathsJson: newImagePaths,
        referencePathsJson: newReferences,
      },
    });
  }
  await logTaskEvent(
    task.taskId,
    "collecting",
    "task_created",
    `复制自 ${taskId}（含已有步骤数据）`,
  );
  return NextResponse.json({ taskId: task.taskId, status: task.status });
}
