import { NextResponse } from "next/server";

import { z } from "zod";

import { getAsset } from "@/lib/assets";
import { db } from "@/lib/db";
import { replaceSeriesLinks, serializeSeries } from "@/lib/series";

/** 合集列表（按更新时间倒序），含集数与主角/画风快照 */
export async function GET() {
  const rows = await db.series.findMany({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }] });
  const series = await Promise.all(rows.map((s) => serializeSeries(s.id)));
  return NextResponse.json({ series });
}

const CreateBody = z.object({
  name: z.string().min(1).max(50),
  intro: z.string().max(2000).optional(),
  styleAssetIds: z.array(z.string().min(1)).min(1),
  protagonistIds: z.array(z.string().min(1)).optional(),
  sceneAssetIds: z.array(z.string().min(1)).optional(),
  memberAssetIds: z.array(z.string().min(1)).optional(),
  /** 内容标签（多选；新建剧集时默认带入） */
  tagIds: z.array(z.string().min(1)).max(12).optional(),
});

/** 新建合集：画风资产至少一个且必须为 style 类型（可多个，剧集创建时从中选本集画风）；主角可选（有些合集无固定主角）；主角/场景/成员必须为已存在资产；资产↔合集落在 AssetSeriesLink */
export async function POST(req: Request) {
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const body = parsed.data;
  const styleIds = [...new Set(body.styleAssetIds)];
  const styleAssets = await Promise.all(styleIds.map((id) => getAsset(id)));
  if (styleAssets.some((a) => !a || a.type !== "style")) {
    return NextResponse.json({ error: "画风必须选择已存在的画风资产" }, { status: 400 });
  }
  const styleIdSet = new Set(styleIds);
  const protoIds = [...new Set(body.protagonistIds ?? [])];
  const protos = await Promise.all(protoIds.map((id) => getAsset(id)));
  if (protos.some((a) => !a || a.type !== "character")) {
    return NextResponse.json({ error: "主角必须选择已存在的角色资产" }, { status: 400 });
  }
  const sceneIds = [...new Set(body.sceneAssetIds ?? [])];
  for (const id of sceneIds) {
    const a = await getAsset(id);
    if (!a || a.type !== "scene") {
      return NextResponse.json({ error: "常设场景必须选择已存在的场景资产" }, { status: 400 });
    }
  }
  const memberIds = [...new Set(body.memberAssetIds ?? [])].filter(
    (id) => !styleIdSet.has(id) && !protoIds.includes(id) && !sceneIds.includes(id),
  );
  for (const id of memberIds) {
    const a = await getAsset(id);
    if (!a) {
      return NextResponse.json({ error: "成员资产不存在" }, { status: 400 });
    }
  }
  const tagIds = [...new Set(body.tagIds ?? [])];
  if (tagIds.length > 0) {
    const found = await db.tag.findMany({ where: { id: { in: tagIds } }, select: { id: true } });
    if (found.length !== tagIds.length) {
      return NextResponse.json({ error: "部分标签不存在" }, { status: 400 });
    }
  }
  const createdId = await db.series.create({
    data: {
      name: body.name.trim(),
      intro: body.intro?.trim() ?? "",
      tags: { create: tagIds.map((tagId) => ({ tagId })) },
    },
  });
  await replaceSeriesLinks(createdId.id, [
    ...styleIds.map((assetId) => ({ assetId, role: "style" as const })),
    ...protoIds.map((assetId) => ({ assetId, role: "protagonist" as const })),
    ...sceneIds.map((assetId) => ({ assetId, role: "scene" as const })),
    ...memberIds.map((assetId) => ({ assetId, role: "member" as const })),
  ]);
  return NextResponse.json({ series: await serializeSeries(createdId.id) });
}
