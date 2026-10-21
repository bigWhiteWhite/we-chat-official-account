import { NextResponse } from "next/server";

import { z } from "zod";

import { assetAppearance, assetPrimaryImage, getAsset } from "@/lib/assets";
import { db } from "@/lib/db";
import { getSeriesAssetLinks } from "@/lib/series";
import { createSseStream } from "@/lib/sse";
import { extendSubject, type ExtendSeries } from "@/pipeline/subject-extend";
import type { AssetRow } from "@/lib/assets";

const Body = z.object({
  userHint: z.string().min(1).max(200),
  /** 可选：新主体加入的合集（以合集第一个画风为参考）；角色/场景主体支持 */
  seriesId: z.string().min(1).optional().nullable(),
  /** 新主体在合集中的身份（角色默认 member；场景固定 scene） */
  seriesRole: z.enum(["protagonist", "member", "scene"]).optional(),
});

/** 加载扩展流程所需的合集上下文（设定 + 画风参考图 + 已有同类主体，防重名） */
async function loadExtendSeries(
  seriesId: string,
  role: "protagonist" | "member" | "scene",
  baseType: "character" | "scene",
): Promise<ExtendSeries> {
  const row = await db.series.findUnique({ where: { id: seriesId } });
  if (!row) throw new Error("合集不存在");
  const linked = await getSeriesAssetLinks(row.id);
  const styleId = linked.styleIds[0] ?? null;
  const style = styleId ? (linked.assetsById.get(styleId) ?? null) : null;
  const existing: Array<{ name: string; characterProfile: string }> =
    baseType === "character"
      ? linked.protagonistIds
          .map((id) => linked.assetsById.get(id))
          .filter((a): a is AssetRow => !!a && a.type === "character")
          .map((a) => ({ name: a.name, characterProfile: a.characterProfile }))
      : linked.sceneAssetIds
          .map((id) => linked.assetsById.get(id))
          .filter((a): a is AssetRow => !!a && a.type === "scene")
          .map((a) => ({ name: a.name, characterProfile: "" }));
  return {
    id: row.id,
    name: row.name,
    intro: row.intro,
    role,
    styleId: style?.id ?? null,
    styleName: style?.name ?? null,
    stylePreset: style?.stylePreset ?? null,
    styleImage: style?.imagePaths[0] ?? null,
    existing,
  };
}

/** SSE：主体扩展（LLM 新设定 + 人设 + img2img 新图 → 新资产入库，可选入合集） */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const base = await getAsset(id);
  if (!base) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { userHint, seriesId, seriesRole } = parsed.data;

  let series: ExtendSeries | undefined;
  if (seriesId) {
    if (base.type !== "character" && base.type !== "scene") {
      return NextResponse.json({ error: "仅角色/场景主体支持加入合集扩展" }, { status: 400 });
    }
    const baseType = base.type as "character" | "scene";
    const role = seriesRole ?? (baseType === "character" ? "member" : "scene");
    if (baseType === "scene" && role !== "scene") {
      return NextResponse.json({ error: "场景扩展加入合集时身份固定为常设场景" }, { status: 400 });
    }
    if (baseType === "character" && role === "scene") {
      return NextResponse.json(
        { error: "角色扩展加入合集时身份只能是主角或成员" },
        { status: 400 },
      );
    }
    try {
      series = await loadExtendSeries(seriesId, role, baseType);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      );
    }
  }

  return createSseStream(async (send) => {
    await extendSubject(
      {
        id: base.id,
        type: base.type as "character" | "scene" | "style",
        name: base.name,
        appearance: assetAppearance(base),
        keywords: base.keywords,
        characterProfile: base.characterProfile,
        personality: base.personality,
        traits: base.traits,
        primaryImage: assetPrimaryImage(base),
        styleId: base.variants[0]?.styleId ?? "",
        styleName: base.variants[0]?.styleName ?? "",
      },
      userHint,
      send,
      series,
    );
  });
}
