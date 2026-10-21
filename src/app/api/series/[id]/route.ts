import { NextResponse } from "next/server";

import { z } from "zod";

import { getAsset } from "@/lib/assets";
import { db } from "@/lib/db";
import { getSeriesAssetLinks, listSeriesEpisodes, serializeSeries } from "@/lib/series";

type Ctx = { params: Promise<{ id: string }> };

/** 合集详情 + 剧集列表（按集数升序） */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const series = await db.series.findUnique({ where: { id } });
  if (!series) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const episodes = await listSeriesEpisodes(id);
  return NextResponse.json({
    series: await serializeSeries(id),
    episodes: episodes.map((e) => {
      let title = e.title ?? "";
      if (!title && e.scriptJson) {
        try {
          title = (JSON.parse(e.scriptJson) as { title?: string }).title ?? "";
        } catch {
          title = "";
        }
      }
      let cover: string | null = null;
      if (e.imagePathsJson) {
        try {
          cover = (JSON.parse(e.imagePathsJson) as (string | null)[]).find((p) => !!p) ?? null;
        } catch {
          cover = null;
        }
      }
      return {
        taskId: e.taskId,
        episodeNo: e.episodeNo,
        title: title || "（无标题）",
        status: e.status,
        digest: e.episodeDigest ?? "",
        cover,
        hasDraft: !!e.draftMediaId,
        createdAt: e.createdAt.toISOString(),
      };
    }),
  });
}

/** 可更新字段。styleAssetIds 整替合集画风（不传沿用；可多选，剧集创建时从中选本集画风） */
const PatchBody = z.object({
  name: z.string().min(1).max(50).optional(),
  intro: z.string().max(2000).optional(),
  status: z.enum(["ongoing", "finished"]).optional(),
  coverPath: z.string().nullable().optional(),
  /** 内容标签（多选，全量替换） */
  tagIds: z.array(z.string().min(1)).max(12).optional(),
  styleAssetIds: z.array(z.string().min(1)).min(1).optional(),
  protagonistIds: z.array(z.string().min(1)).optional(),
  sceneAssetIds: z.array(z.string().min(1)).optional(),
  memberAssetIds: z.array(z.string().min(1)).optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const series = await db.series.findUnique({ where: { id } });
  if (!series) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const body = parsed.data;
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name.trim();
  if (body.intro !== undefined) data.intro = body.intro.trim();
  if (body.status !== undefined) data.status = body.status;
  if (body.coverPath !== undefined) data.coverPath = body.coverPath;

  if (body.tagIds !== undefined) {
    const ids = [...new Set(body.tagIds)];
    const found = await db.tag.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (found.length !== ids.length) {
      return NextResponse.json({ error: "部分标签不存在" }, { status: 400 });
    }
    await db.$transaction([
      db.seriesTag.deleteMany({ where: { seriesId: id } }),
      db.seriesTag.createMany({ data: ids.map((tagId) => ({ seriesId: id, tagId })) }),
    ]);
  }

  const hasLinkChanges =
    body.styleAssetIds !== undefined ||
    body.protagonistIds !== undefined ||
    body.sceneAssetIds !== undefined ||
    body.memberAssetIds !== undefined;
  if (hasLinkChanges) {
    // 未传字段沿用当前关联（编辑表单总是全量回传）
    const linked = await getSeriesAssetLinks(id);
    const styleIds =
      body.styleAssetIds !== undefined ? [...new Set(body.styleAssetIds)] : linked.styleIds;
    const styleAssets = await Promise.all(styleIds.map((sid) => getAsset(sid)));
    if (styleAssets.some((a) => !a || a.type !== "style")) {
      return NextResponse.json({ error: "画风必须选择已存在的画风资产" }, { status: 400 });
    }
    const styleIdSet = new Set(styleIds);
    const protoIds =
      body.protagonistIds !== undefined ? [...new Set(body.protagonistIds)] : linked.protagonistIds;
    const sceneIds =
      body.sceneAssetIds !== undefined ? [...new Set(body.sceneAssetIds)] : linked.sceneAssetIds;
    const memberIds =
      body.memberAssetIds !== undefined
        ? [...new Set(body.memberAssetIds)].filter((x) => !styleIdSet.has(x))
        : linked.memberAssetIds;

    const protos = await Promise.all(protoIds.map((pid) => getAsset(pid)));
    if (protos.some((a) => !a || a.type !== "character")) {
      return NextResponse.json({ error: "主角必须选择已存在的角色资产" }, { status: 400 });
    }
    for (const sid of sceneIds) {
      const a = await getAsset(sid);
      if (!a || a.type !== "scene") {
        return NextResponse.json({ error: "常设场景必须选择已存在的场景资产" }, { status: 400 });
      }
    }
    for (const mid of memberIds) {
      const a = await getAsset(mid);
      if (!a) {
        return NextResponse.json({ error: "成员资产不存在" }, { status: 400 });
      }
    }
    const all = [...styleIds, ...protoIds, ...sceneIds, ...memberIds];
    if (new Set(all).size !== all.length) {
      return NextResponse.json(
        { error: "同一资产不能同时以多种角色加入同一合集" },
        { status: 400 },
      );
    }

    await db.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.series.update({ where: { id }, data });
      }
      await tx.assetSeriesLink.deleteMany({ where: { seriesId: id } });
      await tx.assetSeriesLink.createMany({
        data: [
          ...styleIds.map((assetId) => ({ assetId, seriesId: id, role: "style" })),
          ...protoIds.map((assetId) => ({ assetId, seriesId: id, role: "protagonist" })),
          ...sceneIds.map((assetId) => ({ assetId, seriesId: id, role: "scene" })),
          ...memberIds.map((assetId) => ({ assetId, seriesId: id, role: "member" })),
        ],
      });
    });
  } else if (Object.keys(data).length > 0) {
    await db.series.update({ where: { id }, data });
  }
  return NextResponse.json({ series: await serializeSeries(id) });
}

/** 删除合集：剧集不受影响（Task.seriesId 自动置空） */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const series = await db.series.findUnique({ where: { id } });
  if (!series) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await db.series.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
