import { NextResponse } from "next/server";

import { z } from "zod";

import { rm } from "node:fs/promises";
import path from "node:path";

import { db } from "@/lib/db";
import { getNarrationInImage, getStylePreset } from "@/lib/business-settings";
import { isRunning, runningPanelIndexes } from "@/lib/inflight";
import { getSeriesAssetLinks, getSeriesContextForTask } from "@/lib/series";
import { buildSubjectPrompts, parseSubjectPromptOverrides } from "@/pipeline/artist";
import { buildPanelPrompt } from "@/pipeline/prompts/panel";
import { parseTaskReferences, stylePresetFor } from "@/pipeline/subjects";
import type { ComicScript } from "@/pipeline/schema";

export async function GET(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const t = await db.task.findUnique({
    where: { taskId },
    include: { publishRecord: true, tags: { include: { tag: true } } },
  });
  if (!t) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // 预览布局：优先取请求参数（前端当前选择，生成时即用它），其次任务落库值（仅批量生成后才有）
  const layoutParam = new URL(req.url).searchParams.get("layout");
  const previewLayout =
    layoutParam === "wide" || layoutParam === "tall" ? layoutParam : (t.layout ?? "wide");
  const script = t.scriptJson ? (JSON.parse(t.scriptJson) as ComicScript) : null;
  const refs = parseTaskReferences(t.referencePathsJson);
  const refsForPreset = refs.kind === "new" ? refs.refs : null;
  // 预览用主体参考图提示词：与单主体生成同一套组装逻辑（绑定资产的主体不单独生成）
  const bindingsData = t.subjectBindingsJson
    ? (JSON.parse(t.subjectBindingsJson) as {
        style?: { assetId?: string | null; preset?: string };
      } | null)
    : null;
  const refsForSubjects = refs.kind === "new" ? refs.refs : null;
  // 预览应以用户当前选择为准：t.styleAssetId 由前端 PATCH 实时写入；
  // 上次确认主体时落库的 referencePathsJson / subjectBindingsJson 仅作回落
  const selectedStyleAssetId = t.styleAssetId ?? bindingsData?.style?.assetId;
  const selectedStyleAsset = selectedStyleAssetId
    ? await db.asset.findUnique({
        where: { id: selectedStyleAssetId },
        select: { stylePreset: true },
      })
    : null;
  const effectivePreset =
    selectedStyleAsset?.stylePreset?.trim() ||
    stylePresetFor(refsForPreset, "") ||
    bindingsData?.style?.preset?.trim() ||
    getStylePreset();
  // 预览用逐格提示词：与单格重生成同一套组装逻辑，保证“看到的”就是“发出去的”
  const panelPrompts = script
    ? script.panels.map((p, i) =>
        buildPanelPrompt(script, p, i, effectivePreset, previewLayout, getNarrationInImage()),
      )
    : [];
  const subjectPrompts = await buildSubjectPrompts({
    script,
    refs: refsForSubjects,
    stylePreset: effectivePreset,
    characterPreset: effectivePreset,
    promptOverrides: parseSubjectPromptOverrides(t.subjectPromptOverridesJson),
  });
  return NextResponse.json({
    taskId: t.taskId,
    status: t.status,
    sourceType: t.sourceType,
    tags: t.tags.map((x) => ({ id: x.tag.id, name: x.tag.name, description: x.tag.description })),
    title: t.title ?? script?.title ?? t.outlineText?.slice(0, 20) ?? "",
    script: script,
    panelPrompts,
    subjectPrompts,
    subjectPromptOverrides: parseSubjectPromptOverrides(t.subjectPromptOverridesJson),
    images: t.imagePathsJson ? (JSON.parse(t.imagePathsJson) as (string | null)[]) : [],
    references: t.referencePathsJson
      ? (JSON.parse(t.referencePathsJson) as Record<string, unknown>)
      : null,
    subjectBindings: t.subjectBindingsJson ? (JSON.parse(t.subjectBindingsJson) as unknown) : null,
    reviewResult: t.reviewResult,
    reviewNote: t.reviewNote,
    error: t.error,
    draftMediaId: t.draftMediaId,
    publish: t.publishRecord,
    layout: t.layout,
    generating: isRunning(taskId),
    generatingPanels: runningPanelIndexes(taskId),
    stylePreset: getStylePreset(),
    narrationInImage: getNarrationInImage(),
    createdAt: t.createdAt,
    seriesId: t.seriesId,
    styleAssetId: t.styleAssetId,
    episodeNo: t.episodeNo,
    episodeDigest: t.episodeDigest,
    carryContext: t.carryContext,
    series: t.seriesId ? await getSeriesContextForTask(t) : null,
  });
}

/** 编辑剧本（标题/对话微调后保存），同步落库 title 供列表搜索 */
const PatchBody = z.object({
  script: z.unknown().optional(),
  /** 本集画风（合集多画风：主体确认页切换时写回；null=清除） */
  styleAssetId: z.string().min(1).nullable().optional(),
  /** 单个主体参考图的提示词覆盖（主体提示词弹窗保存） */
  subjectPrompt: z
    .object({
      kind: z.enum(["style", "scene", "character"]),
      name: z.string().trim().min(1).optional(),
      prompt: z.string().trim().min(1).max(2000),
    })
    .optional(),
  /** 合集归属（多选，全量替换）；原主合集被取消时顺延为勾选的第一个并清空集数 */
  seriesIds: z.array(z.string().min(1)).max(20).optional(),
  /** 内容标签（多选，全量替换） */
  tagIds: z.array(z.string().min(1)).max(12).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const t = await db.task.findUnique({ where: { taskId } });
  if (!t) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const data: Record<string, unknown> = {};
  if (parsed.data.script !== undefined) {
    const script = parsed.data.script as { title?: string } | null;
    data.scriptJson = JSON.stringify(parsed.data.script);
    data.title = script && typeof script.title === "string" ? script.title : undefined;
  }
  if (parsed.data.styleAssetId !== undefined) {
    if (parsed.data.styleAssetId === null) {
      data.styleAssetId = null;
    } else {
      const sa = await db.asset.findUnique({ where: { id: parsed.data.styleAssetId } });
      if (!sa || sa.type !== "style") {
        return NextResponse.json({ error: "画风资产不存在或类型不是画风" }, { status: 400 });
      }
      if (t.seriesId) {
        const linked = await getSeriesAssetLinks(t.seriesId);
        if (!linked.styleIds.includes(sa.id)) {
          return NextResponse.json({ error: "本集画风不在该合集的画风列表中" }, { status: 400 });
        }
      }
      data.styleAssetId = sa.id;
    }
  }
  if (parsed.data.subjectPrompt) {
    const { kind, name, prompt } = parsed.data.subjectPrompt;
    if (kind === "character" && !name) {
      return NextResponse.json({ error: "角色提示词缺少角色名" }, { status: 400 });
    }
    const overrides = parseSubjectPromptOverrides(t.subjectPromptOverridesJson);
    const characters = { ...overrides.characters };
    if (kind === "style") overrides.style = prompt;
    else if (kind === "scene") overrides.scene = prompt;
    else characters[name as string] = prompt;
    data.subjectPromptOverridesJson = JSON.stringify(
      kind === "character" ? { ...overrides, characters } : overrides,
    );
  }
  if (parsed.data.seriesIds !== undefined) {
    const ids = [...new Set(parsed.data.seriesIds)];
    const found = await db.series.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (found.length !== ids.length) {
      return NextResponse.json({ error: "部分合集不存在" }, { status: 400 });
    }
    data.seriesLinks = { deleteMany: {}, create: ids.map((sid) => ({ seriesId: sid })) };
    if (!t.seriesId || !ids.includes(t.seriesId)) {
      // 主合集变化/清除：集数属于主合集，一并清空
      data.seriesId = ids[0] ?? null;
      data.episodeNo = null;
    }
  }
  if (parsed.data.tagIds !== undefined) {
    const ids = [...new Set(parsed.data.tagIds)];
    const found = await db.tag.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (found.length !== ids.length) {
      return NextResponse.json({ error: "部分标签不存在" }, { status: 400 });
    }
    data.tags = { deleteMany: {}, create: ids.map((tagId) => ({ tagId })) };
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  }
  await db.task.update({ where: { taskId }, data });
  return NextResponse.json({ ok: true });
}

/** 删除任务：级联删除事件/审核/发布记录，并清理本地图片目录 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const t = await db.task.findUnique({ where: { taskId } });
  if (!t) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const processing = ["collecting", "writing", "drawing", "publishing"];
  if (processing.includes(t.status)) {
    return NextResponse.json({ error: `任务正在${t.status}中，暂不能删除` }, { status: 409 });
  }
  const dir = path.join("data", "images", taskId);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  await db.task.delete({ where: { taskId } });
  return NextResponse.json({ ok: true });
}
