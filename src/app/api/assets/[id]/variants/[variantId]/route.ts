import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import pRetry from "p-retry";
import { z } from "zod";

import { getStylePreset } from "@/lib/business-settings";
import {
  assetVariantPath,
  deleteAssetVariant,
  getAsset,
  imageExtForMime,
  setPrimaryVariant,
  updateAssetVariant,
} from "@/lib/assets";
import { generateCharacterView, generateSceneView } from "@/pipeline/artist";

const PatchBody = z.object({
  name: z.string().max(20).optional(),
  styleId: z.string().max(64).nullable().optional(),
  styleName: z.string().max(50).optional(),
  appearance: z.string().max(500).optional(),
  /** 直接上传新参考图（提供时跳过 AI 重新生成） */
  imageBase64: z.string().max(20_000_000).optional(),
  mimeType: z.enum(["image/png", "image/jpeg"]).optional(),
  size: z.string().optional(),
  /** 同时设为主形象（移到列表首位） */
  setPrimary: z.boolean().optional(),
  /** regenerate: false = 仅保存文本，不动参考图（默认重新生成） */
  regenerate: z.boolean().optional(),
});

/**
 * PATCH：修改形象变体（形象名/画风/外观设定）。
 * 未传 imageBase64 且改了画风或外观设定时，按 新画风+新外观设定 重新文生图（regenerate: false 则仅保存文本）；
 * 传 imageBase64 则直接替换参考图。
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; variantId: string }> },
) {
  const { id, variantId } = await params;
  const asset = await getAsset(id);
  if (!asset || (asset.type !== "character" && asset.type !== "scene")) {
    return NextResponse.json({ error: "仅角色/场景资产支持形象变体" }, { status: 400 });
  }
  const variant = asset.variants.find((v) => v.id === variantId);
  if (!variant) {
    return NextResponse.json({ error: "形象变体不存在" }, { status: 404 });
  }
  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const body = parsed.data;
  const size = body.size;
  const newStyleId =
    body.styleId !== undefined && body.styleId !== null ? body.styleId : variant.styleId;
  const style = newStyleId ? await getAsset(newStyleId) : null;
  if (newStyleId && (!style || style.type !== "style")) {
    return NextResponse.json({ error: "所选画风资产不存在或类型不是画风" }, { status: 400 });
  }
  const preset = style?.stylePreset?.trim() || getStylePreset();
  const name = body.name !== undefined ? body.name.trim() || variant.name : variant.name;
  const styleName =
    body.styleName !== undefined ? body.styleName : (style?.name ?? variant.styleName);
  const appearance = body.appearance !== undefined ? body.appearance.trim() : variant.appearance;
  const regen =
    body.imageBase64 === undefined &&
    body.regenerate !== false &&
    (body.styleId !== undefined || body.appearance !== undefined);
  try {
    let image = variant.image;
    if (body.imageBase64) {
      const dst = assetVariantPath(asset.type, id, variantId, imageExtForMime(body.mimeType));
      await mkdir(path.dirname(dst), { recursive: true });
      await writeFile(dst, Buffer.from(body.imageBase64, "base64"));
      image = dst;
    } else if (regen) {
      const appearanceText = appearance.trim() || variant.appearance.trim() || asset.name;
      const dst = assetVariantPath(asset.type, id, variantId);
      await pRetry(
        () =>
          asset.type === "character"
            ? generateCharacterView(asset.name, appearanceText, preset, dst, size)
            : generateSceneView(appearanceText, preset, dst, size),
        { retries: 1 },
      );
      image = dst;
    }
    let updated = await updateAssetVariant(id, variantId, {
      name,
      styleId: newStyleId,
      styleName,
      appearance,
      image,
    });
    if (body.setPrimary) {
      updated = await setPrimaryVariant(id, variantId);
    }
    return NextResponse.json({ asset: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE：删除形象变体（含图片文件） */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; variantId: string }> },
) {
  const { id, variantId } = await params;
  try {
    const updated = await deleteAssetVariant(id, variantId);
    return NextResponse.json({ asset: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /不存在/.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
