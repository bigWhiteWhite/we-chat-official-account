import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { NextResponse } from "next/server";
import pRetry from "p-retry";
import { z } from "zod";

import { getStylePreset } from "@/lib/business-settings";
import { addAssetVariant, assetVariantPath, getAsset, imageExtForMime } from "@/lib/assets";
import { generateCharacterView, generateSceneView } from "@/pipeline/artist";

const Body = z.object({
  /** 形象名（可选，缺省「形象」） */
  name: z.string().max(20).optional(),
  /** 目标画风资产 id（可空 = 不关联画风） */
  styleId: z.string().max(64).optional(),
  styleName: z.string().max(50).optional(),
  /** 外观设定（提示词输入框；留空 = 主形象外观或资产名） */
  appearance: z.string().max(500).optional(),
  /** 直接上传本地参考图（提供时跳过 AI 生成） */
  imageBase64: z.string().max(20_000_000).optional(),
  mimeType: z.enum(["image/png", "image/jpeg"]).optional(),
  size: z.string().optional(),
});

/**
 * POST：为角色/场景资产新增一个形象变体。
 * 文生图拼接与主体确认同一结构：画风 preset + 三视图/空镜框架 + 外观设定；
 * 传 imageBase64 时直接落盘（本地上传参考图）。
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset || (asset.type !== "character" && asset.type !== "scene")) {
    return NextResponse.json({ error: "仅角色/场景资产支持形象变体" }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { name, styleId, styleName, appearance, imageBase64, mimeType, size } = parsed.data;
  const style = styleId ? await getAsset(styleId) : null;
  if (styleId && (!style || style.type !== "style")) {
    return NextResponse.json({ error: "所选画风资产不存在或类型不是画风" }, { status: 400 });
  }
  const preset = style?.stylePreset?.trim() || getStylePreset();
  const vid = randomUUID();
  const dst = assetVariantPath(asset.type, id, vid, imageExtForMime(mimeType));
  try {
    if (imageBase64) {
      await mkdir(path.dirname(dst), { recursive: true });
      await writeFile(dst, Buffer.from(imageBase64, "base64"));
    } else {
      const appearanceText =
        (appearance ?? "").trim() || asset.variants[0]?.appearance?.trim() || asset.name;
      await pRetry(
        () =>
          asset.type === "character"
            ? generateCharacterView(asset.name, appearanceText, preset, dst, size)
            : generateSceneView(appearanceText, preset, dst, size),
        { retries: 1 },
      );
    }
    const updated = await addAssetVariant(id, {
      id: vid,
      name: (name ?? "").trim() || "形象",
      styleId: styleId ?? "",
      styleName: (styleName ?? "").trim() || (style?.name ?? ""),
      appearance: (appearance ?? "").trim(),
      image: dst,
    });
    return NextResponse.json({ asset: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
