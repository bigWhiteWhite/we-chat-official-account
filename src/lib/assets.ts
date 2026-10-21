import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { db } from "./db";

export type AssetType = "character" | "scene" | "style";

/** 形象变体：角色/场景资产的一个形象（画风 + 外观设定 + 参考图）；列表首项为主形象 */
export type AssetVariant = {
  id: string;
  name: string;
  styleId: string;
  styleName: string;
  appearance: string;
  image: string;
};

/** 变体图片来源：base64 或已存在的服务器端路径（二选一） */
export type VariantImageSource = {
  imageBase64?: string;
  imagePath?: string;
  mimeType?: string;
};

export type AssetInput = {
  type: AssetType;
  name: string;
  keywords?: string;
  characterProfile?: string;
  personality?: string;
  traits?: string;
  stylePreset?: string;
  sourceTaskId?: string;
  /** 画风资产样图（仅 style 类型使用） */
  imagePaths?: string[];
  imageBase64?: string;
  mimeType?: string;
  /** 角色/场景的首个（主）形象变体 */
  firstVariant?: {
    name?: string;
    styleId?: string;
    styleName?: string;
    appearance?: string;
  } & VariantImageSource;
};

export type AssetRow = {
  id: string;
  type: AssetType;
  name: string;
  keywords: string;
  characterProfile: string;
  personality: string;
  traits: string;
  imagePaths: string[];
  variants: AssetVariant[];
  /** 主参考图（缩略图/兜底参考）：角色/场景取主形象，画风取样图 */
  primaryImage: string | null;
  stylePreset: string | null;
  sourceTaskId: string | null;
  usageCount: number;
  /** 展示顺序（拖拽排序持久化） */
  sortOrder: number;
  createdAt: Date;
  /** 所属合集关联（可多合集）：seriesId / 合集名 / 角色 */
  seriesLinks: Array<{ seriesId: string; seriesName: string; role: string }>;
};

type AssetRecord = {
  id: string;
  type: string;
  name: string;
  keywords: string;
  characterProfile: string;
  personality: string;
  traits: string;
  imagePathsJson: string;
  variantsJson: string;
  stylePreset: string | null;
  sourceTaskId: string | null;
  usageCount: number;
  sortOrder: number;
  createdAt: Date;
};

type AssetLinksRaw = Array<{ role: string; series: { id: string; name: string } | null }>;

/** 查询资产时统一的合集关联 include（附带合集 id/名称，供目录树与徽章使用） */
const ASSET_LINKS_INCLUDE = {
  links: { include: { series: { select: { id: true, name: true } } } },
};

/** 原始 links 行 → 资产行上的 seriesLinks（无关联/合集已删时安全返回空） */
function toSeriesLinks(links: AssetLinksRaw | undefined) {
  return (links ?? [])
    .filter((l) => !!l.series)
    .map((l) => ({ seriesId: l.series!.id, seriesName: l.series!.name, role: l.role }));
}

export function assetDir(type: AssetType, id: string): string {
  return path.join("data", "assets", type, id);
}

/** 画风资产样图（view-NN）文件路径 */
export function assetImagePath(type: AssetType, id: string, index: number): string {
  return path.join(assetDir(type, id), `view-${String(index + 1).padStart(2, "0")}.png`);
}

/** 资产某形象变体的图片文件路径（uuid 可安全作文件名） */
export function assetVariantPath(
  type: AssetType,
  id: string,
  variantId: string,
  ext = ".png",
): string {
  return path.join(assetDir(type, id), `variant-${variantId}${ext}`);
}

const MIME_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
};

/** 由 MIME 类型得到图片文件扩展名（默认 .png） */
export function imageExtForMime(mime?: string): string {
  return (mime && MIME_EXT[mime]) || ".png";
}

export function parseVariants(json: string | null | undefined): AssetVariant[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as Array<Record<string, unknown>>;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((v) => typeof v?.id === "string" && typeof v?.image === "string")
      .map((v) => ({
        id: v.id as string,
        name: typeof v.name === "string" ? v.name : "",
        styleId: typeof v.styleId === "string" ? v.styleId : "",
        styleName: typeof v.styleName === "string" ? v.styleName : "",
        appearance: typeof v.appearance === "string" ? v.appearance : "",
        image: v.image as string,
      }));
  } catch {
    return [];
  }
}

/** 主形象外观设定（LLM 提示词/检索的回退文本；画风资产返回空串） */
export function assetAppearance(a: { type: AssetType; variants: AssetVariant[] }): string {
  if (a.type === "style") return "";
  return a.variants[0]?.appearance ?? "";
}

/** 资产主参考图（兼容旧调用：画风取样图，角色/场景取主形象） */
export function assetPrimaryImage(a: { primaryImage: string | null }): string | null {
  return a.primaryImage;
}

function toRow(a: AssetRecord): AssetRow {
  const type = a.type as AssetType;
  const imagePaths = JSON.parse(a.imagePathsJson) as string[];
  const variants = parseVariants(a.variantsJson);
  return {
    id: a.id,
    type,
    name: a.name,
    keywords: a.keywords,
    characterProfile: a.characterProfile,
    personality: a.personality,
    traits: a.traits,
    imagePaths,
    variants,
    primaryImage: type === "style" ? (imagePaths[0] ?? null) : (variants[0]?.image ?? null),
    stylePreset: a.stylePreset,
    sourceTaskId: a.sourceTaskId,
    usageCount: a.usageCount,
    sortOrder: a.sortOrder,
    createdAt: a.createdAt,
    seriesLinks: toSeriesLinks((a as AssetRecord & { links?: AssetLinksRaw }).links),
  };
}

export async function listAssets(
  params: { type?: AssetType; q?: string; seriesId?: string } = {},
): Promise<AssetRow[]> {
  const where: Record<string, unknown> = {};
  if (params.type) where.type = params.type;
  if (params.seriesId) where.links = { some: { seriesId: params.seriesId } };
  if (params.q) {
    where.OR = [{ name: { contains: params.q } }, { keywords: { contains: params.q } }];
  }
  const rows = await db.asset.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: ASSET_LINKS_INCLUDE,
  });
  let out = rows.map(toRow);
  if (params.q) {
    const kw = params.q.toLowerCase();
    out = out.filter(
      (a) =>
        a.name.toLowerCase().includes(kw) ||
        a.keywords.toLowerCase().includes(kw) ||
        (a.type === "style" && a.stylePreset?.toLowerCase().includes(kw)) ||
        a.variants.some(
          (v) => v.name.toLowerCase().includes(kw) || v.appearance.toLowerCase().includes(kw),
        ),
    );
  }
  return out;
}

export async function getAsset(id: string): Promise<AssetRow | null> {
  const a = await db.asset.findUnique({
    where: { id },
    include: ASSET_LINKS_INCLUDE,
  });
  return a ? toRow(a) : null;
}

/** 把变体图片落盘（base64 写入或服务器路径复制），返回落盘路径 */
async function writeVariantImage(
  type: AssetType,
  assetId: string,
  src: { id: string } & VariantImageSource,
): Promise<string> {
  const dst = assetVariantPath(type, assetId, src.id, imageExtForMime(src.mimeType));
  await mkdir(path.dirname(dst), { recursive: true });
  if (src.imageBase64) {
    await writeFile(dst, Buffer.from(src.imageBase64, "base64"));
  } else if (src.imagePath) {
    await copyFile(path.resolve(src.imagePath), dst);
  } else {
    throw new Error("变体缺少图片来源");
  }
  return dst;
}

/** 创建资产：画风样图（style）/主形象变体图（角色/场景）落盘至 data/assets/<type>/<id>/ 后入库 */
export async function createAsset(input: AssetInput): Promise<AssetRow> {
  if (!input.name.trim()) throw new Error("资产名称不能为空");
  const created = await db.asset.create({
    data: {
      type: input.type,
      name: input.name.trim(),
      keywords: input.keywords?.trim() ?? "",
      characterProfile: input.characterProfile?.trim() ?? "",
      personality: input.personality?.trim() ?? "",
      traits: input.traits?.trim() ?? "",
      stylePreset: input.stylePreset?.trim() || null,
      sourceTaskId: input.sourceTaskId ?? null,
      imagePathsJson: "[]",
      variantsJson: "[]",
    },
  });
  if (input.type === "style") {
    const saved: string[] = [];
    const srcPaths = input.imagePaths ?? [];
    for (let i = 0; i < srcPaths.length; i++) {
      const src = path.resolve(srcPaths[i]);
      const dst = assetImagePath(input.type, created.id, i);
      await mkdir(path.dirname(dst), { recursive: true });
      await copyFile(src, dst);
      saved.push(dst);
    }
    if (saved.length === 0 && input.imageBase64) {
      const dir = assetDir(input.type, created.id);
      const dst = path.join(dir, `view-01${imageExtForMime(input.mimeType)}`);
      await mkdir(dir, { recursive: true });
      await writeFile(dst, Buffer.from(input.imageBase64, "base64"));
      saved.push(dst);
    }
    if (saved.length > 0) {
      await db.asset.update({
        where: { id: created.id },
        data: { imagePathsJson: JSON.stringify(saved) },
      });
    }
  } else if (input.firstVariant) {
    const fv = input.firstVariant;
    const vid = randomUUID();
    const image = await writeVariantImage(input.type, created.id, { id: vid, ...fv });
    const variant: AssetVariant = {
      id: vid,
      name: (fv.name ?? "").trim() || "主形象",
      styleId: (fv.styleId ?? "").trim(),
      styleName: (fv.styleName ?? "").trim(),
      appearance: (fv.appearance ?? "").trim(),
      image,
    };
    await db.asset.update({
      where: { id: created.id },
      data: { variantsJson: JSON.stringify([variant]) },
    });
  }
  return (await getAsset(created.id))!;
}

export async function updateAsset(
  id: string,
  data: {
    name?: string;
    keywords?: string;
    characterProfile?: string;
    personality?: string;
    traits?: string;
    stylePreset?: string;
  },
): Promise<AssetRow> {
  const existing = await db.asset.findUnique({ where: { id } });
  if (!existing) throw new Error("资产不存在");
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) patch.name = data.name.trim();
  if (data.keywords !== undefined) patch.keywords = data.keywords.trim();
  if (data.characterProfile !== undefined) patch.characterProfile = data.characterProfile.trim();
  if (data.personality !== undefined) patch.personality = data.personality.trim();
  if (data.traits !== undefined) patch.traits = data.traits.trim();
  if (data.stylePreset !== undefined) patch.stylePreset = data.stylePreset.trim() || null;
  const a = await db.asset.update({ where: { id }, data: patch });
  return toRow(a);
}

/** 替换画风资产样图（view-01）：写入新图、删除旧样图文件并更新 imagePaths[0] */
export async function replacePrimaryImage(
  id: string,
  imageBase64: string,
  mimeType?: string,
): Promise<AssetRow> {
  const existing = await db.asset.findUnique({ where: { id } });
  if (!existing) throw new Error("资产不存在");
  const oldPaths = JSON.parse(existing.imagePathsJson) as string[];
  const oldPrimary = oldPaths[0];
  const dir = assetDir(existing.type as AssetType, id);
  const dst = path.join(dir, `view-01${imageExtForMime(mimeType)}`);
  await mkdir(dir, { recursive: true });
  await writeFile(dst, Buffer.from(imageBase64, "base64"));
  if (oldPrimary && path.resolve(oldPrimary) !== path.resolve(dst)) {
    await rm(oldPrimary, { force: true }).catch(() => {});
  }
  const a = await db.asset.update({
    where: { id },
    data: { imagePathsJson: JSON.stringify([dst, ...oldPaths.slice(1)]) },
  });
  return toRow(a);
}

/** 移除画风资产样图：尽力删除文件并清空 imagePaths */
export async function removeAssetImages(id: string): Promise<AssetRow> {
  const existing = await db.asset.findUnique({ where: { id } });
  if (!existing) throw new Error("资产不存在");
  const oldPaths = JSON.parse(existing.imagePathsJson) as string[];
  for (const p of oldPaths) {
    await rm(p, { force: true }).catch(() => {});
  }
  const a = await db.asset.update({ where: { id }, data: { imagePathsJson: "[]" } });
  return toRow(a);
}

/** 新增一个形象变体（追加到列表末尾；图片须已由调用方落盘） */
export async function addAssetVariant(
  id: string,
  variant: Omit<AssetVariant, "id"> & { id?: string },
): Promise<AssetRow> {
  const existing = await db.asset.findUnique({ where: { id } });
  if (!existing) throw new Error("资产不存在");
  if (existing.type === "style") throw new Error("画风资产不使用形象变体");
  const variants = parseVariants(existing.variantsJson);
  variants.push({
    id: variant.id ?? randomUUID(),
    name: variant.name.trim() || "形象",
    styleId: variant.styleId ?? "",
    styleName: variant.styleName ?? "",
    appearance: variant.appearance ?? "",
    image: variant.image,
  });
  await db.asset.update({
    where: { id },
    data: { variantsJson: JSON.stringify(variants) },
  });
  return (await getAsset(id))!;
}

/** 更新一个形象变体（参考图路径变化时清理旧图文件） */
export async function updateAssetVariant(
  id: string,
  variantId: string,
  patch: Partial<Omit<AssetVariant, "id">>,
): Promise<AssetRow> {
  const existing = await db.asset.findUnique({ where: { id } });
  if (!existing) throw new Error("资产不存在");
  const variants = parseVariants(existing.variantsJson);
  const idx = variants.findIndex((v) => v.id === variantId);
  if (idx < 0) throw new Error("形象变体不存在");
  const old = variants[idx];
  variants[idx] = {
    id: old.id,
    name: patch.name !== undefined ? patch.name : old.name,
    styleId: patch.styleId !== undefined ? patch.styleId : old.styleId,
    styleName: patch.styleName !== undefined ? patch.styleName : old.styleName,
    appearance: patch.appearance !== undefined ? patch.appearance : old.appearance,
    image: patch.image !== undefined ? patch.image : old.image,
  };
  await db.asset.update({
    where: { id },
    data: { variantsJson: JSON.stringify(variants) },
  });
  if (variants[idx].image !== old.image) {
    await rm(old.image, { force: true }).catch(() => {});
  }
  return (await getAsset(id))!;
}

/** 删除一个形象变体并清理图片文件 */
export async function deleteAssetVariant(id: string, variantId: string): Promise<AssetRow> {
  const existing = await db.asset.findUnique({ where: { id } });
  if (!existing) throw new Error("资产不存在");
  const variants = parseVariants(existing.variantsJson);
  const target = variants.find((v) => v.id === variantId);
  if (!target) throw new Error("形象变体不存在");
  await rm(target.image, { force: true }).catch(() => {});
  await db.asset.update({
    where: { id },
    data: { variantsJson: JSON.stringify(variants.filter((v) => v.id !== variantId)) },
  });
  return (await getAsset(id))!;
}

/** 将指定变体设为主形象（移到列表首位） */
export async function setPrimaryVariant(id: string, variantId: string): Promise<AssetRow> {
  const existing = await db.asset.findUnique({ where: { id } });
  if (!existing) throw new Error("资产不存在");
  const variants = parseVariants(existing.variantsJson);
  const idx = variants.findIndex((v) => v.id === variantId);
  if (idx < 0) throw new Error("形象变体不存在");
  if (idx > 0) {
    const [v] = variants.splice(idx, 1);
    variants.unshift(v);
    await db.asset.update({
      where: { id },
      data: { variantsJson: JSON.stringify(variants) },
    });
  }
  return (await getAsset(id))!;
}

/** 删除 DB 记录，并尽力删除资产目录（失败忽略，孤儿文件无害） */
export async function deleteAsset(id: string): Promise<boolean> {
  const a = await db.asset.findUnique({ where: { id } });
  if (!a) return false;
  await db.asset.delete({ where: { id } });
  await rm(assetDir(a.type as AssetType, id), { recursive: true, force: true }).catch(() => {});
  return true;
}

export async function touchUsage(id: string): Promise<void> {
  await db.asset.update({ where: { id }, data: { usageCount: { increment: 1 } } });
}

/** 资产拖拽排序：order 为新的全局顺序（资产 id 数组）；只更新仍存在的 id，顺序号按 0..n 重写 */
export async function reorderAssets(order: string[]): Promise<void> {
  if (order.length === 0) return;
  const existing = await db.asset.findMany({ where: { id: { in: order } }, select: { id: true } });
  const idSet = new Set(existing.map((a) => a.id));
  // 紧凑编号：过滤掉不存在的 id 后按 0..n-1 重新编号，避免陈旧列表留下空洞或撞号
  let index = -1;
  const updates: ReturnType<typeof db.asset.update>[] = [];
  for (const id of order) {
    if (!idSet.has(id)) continue;
    index += 1;
    updates.push(db.asset.update({ where: { id }, data: { sortOrder: index } }));
  }
  if (updates.length > 0) {
    await db.$transaction(updates);
  }
}
