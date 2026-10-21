import { NextResponse } from "next/server";

import { z } from "zod";

import { createAsset, deleteAsset, getAsset, listAssets, type AssetType } from "@/lib/assets";
import {
  inferAssetSeriesRole,
  replaceAssetLinks,
  validateAssetSeriesLinks,
  type AssetSeriesRole,
} from "@/lib/series";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const seriesId = url.searchParams.get("seriesId") ?? undefined;
  if (type && !["character", "scene", "style"].includes(type)) {
    return NextResponse.json({ error: "type 无效" }, { status: 400 });
  }
  const assets = await listAssets({ type: type as AssetType | undefined, q, seriesId });
  return NextResponse.json({ assets });
}

const Body = z.object({
  type: z.enum(["character", "scene", "style"]),
  name: z.string().min(1).max(50),
  keywords: z.string().max(200).optional(),
  characterProfile: z.string().max(500).optional(),
  personality: z.string().max(500).optional(),
  traits: z.string().max(500).optional(),
  stylePreset: z.string().max(300).optional(),
  sourceTaskId: z.string().optional(),
  imagePaths: z.array(z.string()).max(9).optional(),
  imageBase64: z.string().max(20_000_000).optional(),
  mimeType: z.enum(["image/png", "image/jpeg"]).optional(),
  /** 角色/场景的首个（主）形象变体 */
  firstVariant: z
    .object({
      name: z.string().max(20).optional(),
      styleId: z.string().max(64).optional(),
      styleName: z.string().max(50).optional(),
      appearance: z.string().max(500).optional(),
      imageBase64: z.string().max(20_000_000).optional(),
      imagePath: z.string().max(500).optional(),
      mimeType: z.enum(["image/png", "image/jpeg"]).optional(),
    })
    .optional(),
  /** 所属合集（全量替换；role 缺省按资产类型推断） */
  seriesLinks: z
    .array(
      z.object({
        seriesId: z.string().min(1),
        role: z.enum(["protagonist", "scene", "style", "member"]).optional(),
      }),
    )
    .optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { seriesLinks, ...createData } = parsed.data;
  try {
    let asset = await createAsset(createData);
    if (seriesLinks && seriesLinks.length > 0) {
      const err = await validateAssetSeriesLinks(asset.id, asset.type, seriesLinks);
      if (err) {
        // 回滚刚创建的资产，避免留下无关联的孤儿记录
        await deleteAsset(asset.id);
        return NextResponse.json({ error: err }, { status: 400 });
      }
      await replaceAssetLinks(
        asset.id,
        seriesLinks.map((e) => ({
          seriesId: e.seriesId,
          role: (e.role as AssetSeriesRole | undefined) ?? inferAssetSeriesRole(asset.type),
        })),
      );
      asset = (await getAsset(asset.id))!;
    }
    return NextResponse.json({ asset });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
