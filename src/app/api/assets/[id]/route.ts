import { NextResponse } from "next/server";

import { z } from "zod";

import {
  deleteAsset,
  getAsset,
  removeAssetImages,
  replacePrimaryImage,
  updateAsset,
} from "@/lib/assets";
import {
  inferAssetSeriesRole,
  replaceAssetLinks,
  validateAssetSeriesLinks,
  type AssetSeriesRole,
} from "@/lib/series";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ asset });
}

const PatchBody = z.object({
  name: z.string().min(1).max(50).optional(),
  keywords: z.string().max(200).optional(),
  characterProfile: z.string().max(500).optional(),
  personality: z.string().max(500).optional(),
  traits: z.string().max(500).optional(),
  stylePreset: z.string().max(300).optional(),
  imageBase64: z.string().max(20_000_000).optional(),
  mimeType: z.enum(["image/png", "image/jpeg"]).optional(),
  removeImage: z.boolean().optional(),
  /** 所属合集（全量替换该资产的合集关联；可多合集） */
  seriesLinks: z
    .array(
      z.object({
        seriesId: z.string().min(1),
        role: z.enum(["protagonist", "scene", "style", "member"]).optional(),
      }),
    )
    .optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await getAsset(id);
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { imageBase64, mimeType, removeImage, seriesLinks, ...textData } = parsed.data;
  let asset = await updateAsset(id, textData);
  if (removeImage) {
    asset = await removeAssetImages(id);
  } else if (imageBase64) {
    asset = await replacePrimaryImage(id, imageBase64, mimeType);
  }
  if (seriesLinks !== undefined) {
    const err = await validateAssetSeriesLinks(id, existing.type, seriesLinks);
    if (err) {
      return NextResponse.json({ error: err }, { status: 400 });
    }
    await replaceAssetLinks(
      id,
      seriesLinks.map((e) => ({
        seriesId: e.seriesId,
        role: (e.role as AssetSeriesRole | undefined) ?? inferAssetSeriesRole(existing.type),
      })),
    );
    asset = (await getAsset(id))!;
  }
  return NextResponse.json({ asset });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteAsset(id);
  if (!ok) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
