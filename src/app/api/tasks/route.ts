import { NextResponse } from "next/server";

import { z } from "zod";

import { rm } from "node:fs/promises";
import path from "node:path";

import { db } from "@/lib/db";
import { getSeriesAssetLinks } from "@/lib/series";
import { logTaskEvent } from "@/lib/task-events";
import { buildTaskWhere } from "@/lib/task-query";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const where = buildTaskWhere({
    q: sp.get("q") ?? undefined,
    status: sp.get("status") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    id: sp.get("id") ?? undefined,
    seriesId: sp.get("seriesId") ?? undefined,
    tagId: sp.get("tagId") ?? undefined,
  });
  const tasks = await db.task.findMany({
    where,
    include: {
      series: { select: { name: true } },
      seriesLinks: { include: { series: { select: { name: true } } } },
      tags: { include: { tag: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({
    tasks: tasks.map((t) => {
      const script = t.scriptJson ? (JSON.parse(t.scriptJson) as { title?: string }) : null;
      // 归属列表：主合集排首（存量数据 links 缺主合集行也照常展示）
      const rest = t.seriesLinks
        .filter((l) => l.seriesId !== t.seriesId)
        .map((l) => ({ seriesId: l.seriesId, seriesName: l.series.name }));
      const primary =
        t.seriesId != null ? [{ seriesId: t.seriesId, seriesName: t.series?.name ?? "" }] : [];
      return {
        taskId: t.taskId,
        status: t.status,
        title: t.title ?? script?.title ?? t.outlineText?.slice(0, 20) ?? "",
        sourceType: t.sourceType,
        tags: t.tags.map((x) => x.tag),
        imageCnt: t.imageCnt,
        draftMediaId: t.draftMediaId,
        error: t.error,
        createdAt: t.createdAt,
        seriesName: t.series?.name ?? null,
        seriesLinks: [...primary, ...rest],
        episodeNo: t.episodeNo,
      };
    }),
  });
}

const CreateBody = z.object({
  sourceType: z.enum(["self-made", "user-outline", "user-script"]),
  outline: z.string().max(20000).optional(),
  /** 内容标签 id（多选，替代旧题材方向/类别） */
  tagIds: z.array(z.string().min(1)).max(12).optional(),
  seriesId: z.string().min(1).optional(),
  /** 本集画风资产 id（合集多画风；不传时回落到合集第一个画风） */
  styleAssetId: z.string().min(1).optional(),
  carryContext: z.boolean().optional(),
  /** 本集出场角色（资产 id；空=合集全部主角） */
  episodeCharacterIds: z.array(z.string().min(1)).max(20).optional(),
});

/** 向导入口：建一个空白任务（collecting），后续步骤由前端逐步调用各端点。 */
export async function POST(req: Request) {
  const parsed = CreateBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  let episodeNo: number | null = null;
  if (parsed.data.seriesId) {
    const series = await db.series.findUnique({ where: { id: parsed.data.seriesId } });
    if (!series) {
      return NextResponse.json({ error: "合集不存在" }, { status: 400 });
    }
    const last = await db.task.findFirst({
      where: { seriesId: series.id },
      orderBy: { episodeNo: "desc" },
      select: { episodeNo: true },
    });
    episodeNo = (last?.episodeNo ?? 0) + 1;
  }
  /** 本集画风：显式传入时校验存在且属于该合集；不传时回落到合集第一个画风 */
  let styleAssetId: string | null = null;
  if (parsed.data.seriesId) {
    const linked = await getSeriesAssetLinks(parsed.data.seriesId);
    if (parsed.data.styleAssetId) {
      const sa = await db.asset.findUnique({ where: { id: parsed.data.styleAssetId } });
      if (!sa || sa.type !== "style") {
        return NextResponse.json({ error: "本集画风资产不存在或类型不是画风" }, { status: 400 });
      }
      if (!linked.styleIds.includes(sa.id)) {
        return NextResponse.json({ error: "本集画风不在该合集的画风列表中" }, { status: 400 });
      }
      styleAssetId = sa.id;
    } else {
      styleAssetId = linked.styleIds[0] ?? null;
    }
  }
  /** 标签校验：必须全部存在 */
  const tagIds = [...new Set(parsed.data.tagIds ?? [])];
  if (tagIds.length > 0) {
    const found = await db.tag.findMany({ where: { id: { in: tagIds } }, select: { id: true } });
    if (found.length !== tagIds.length) {
      return NextResponse.json({ error: "部分标签不存在" }, { status: 400 });
    }
  }
  const task = await db.task.create({
    data: {
      sourceType: parsed.data.sourceType,
      outlineText: parsed.data.outline ?? null,
      status: "collecting",
      seriesId: parsed.data.seriesId ?? null,
      episodeNo,
      carryContext: parsed.data.carryContext ?? false,
      styleAssetId,
      tags: { create: tagIds.map((tagId) => ({ tagId })) },
      castIdsJson:
        parsed.data.episodeCharacterIds && parsed.data.episodeCharacterIds.length > 0
          ? JSON.stringify([...new Set(parsed.data.episodeCharacterIds)])
          : null,
    },
  });
  await logTaskEvent(task.taskId, "collecting", "task_created", task.sourceType);
  return NextResponse.json({
    taskId: task.taskId,
    status: task.status,
    seriesId: task.seriesId,
    styleAssetId,
    episodeNo,
  });
}

const BulkDeleteBody = z.object({
  taskIds: z.array(z.string().min(1)).min(1).max(100),
});

/** 批量删除：跳过进行中的任务（返回 skipped），其余级联删除并清理本地图片目录。 */
export async function DELETE(req: Request) {
  const parsed = BulkDeleteBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const processing = ["collecting", "writing", "drawing", "publishing"];
  const deleted: string[] = [];
  const skipped: string[] = [];
  for (const taskId of parsed.data.taskIds) {
    const t = await db.task.findUnique({ where: { taskId } });
    if (!t) continue;
    if (processing.includes(t.status)) {
      skipped.push(taskId);
      continue;
    }
    await rm(path.join("data", "images", taskId), { recursive: true, force: true }).catch(() => {});
    await db.task.delete({ where: { taskId } });
    deleted.push(taskId);
  }
  return NextResponse.json({ deleted, skipped });
}
