import { randomUUID } from "node:crypto";

import { generateObject } from "ai";

import { addAssetVariant, assetVariantPath, createAsset, deleteAsset } from "@/lib/assets";
import { replaceAssetLinks } from "@/lib/series";
import { getModel } from "@/model-manager";

import { callImageEdits } from "./artist";
import { buildExtendImagePrompt, buildExtendPrompt } from "./prompts/subjects";
import { ExtendSubjectSchema } from "./subjects";

export type ExtendBaseAsset = {
  id: string;
  type: "character" | "scene" | "style";
  name: string;
  /** 主形象外观设定 */
  appearance: string;
  keywords: string;
  characterProfile?: string;
  personality?: string;
  traits?: string;
  /** 主形象参考图（img2img 参考） */
  primaryImage: string | null;
  /** 主形象的画风（扩展时新主体默认沿用） */
  styleId: string;
  styleName: string;
};

/** 扩展目标合集（可选）：锁定画风参考图，完成后将新资产关联到该合集 */
export type ExtendSeries = {
  id: string;
  name: string;
  intro: string;
  /** 新主体在合集中的角色：protagonist 主角 / member 成员 / scene 常设场景 */
  role: "protagonist" | "member" | "scene";
  styleId: string | null;
  styleName: string | null;
  stylePreset: string | null;
  styleImage: string | null;
  existing: Array<{ name: string; characterProfile: string }>;
};

export type ExtendEvent =
  | { type: "stage"; message: string }
  | {
      type: "profile";
      name: string;
      appearance: string;
      keywords: string;
      characterProfile: string;
      personality: string;
      traits: string;
    }
  | {
      type: "done";
      assetId: string;
      image: string;
      seriesId?: string;
      seriesName?: string;
      seriesRole?: "protagonist" | "member" | "scene";
    };

/**
 * 主体扩展：LLM 依据参考主体 + 用户指令（+ 合集上下文）产出新主体设定
 * （name / appearance / keywords / 人设三字段），再以原主体主形象图（+ 合集画风图）
 * 为参考 img2img 生成新三视图/新场景图，作为新资产的主形象变体入库。
 * 新资产变体画风：指定合集时取合集画风，否则沿用原主体画风。
 * 指定合集时，生成成功后将新资产关联到合集（主角/成员/常设场景）。
 * 生图失败时回滚删除刚创建的空资产。
 */
export async function extendSubject(
  base: ExtendBaseAsset,
  userHint: string,
  send: (ev: unknown) => void,
  series?: ExtendSeries,
): Promise<string> {
  if (base.type === "style") {
    throw new Error("画风主体不支持扩展");
  }
  if (series) {
    if (base.type === "scene" && series.role !== "scene") {
      throw new Error("场景扩展加入合集时身份固定为常设场景");
    }
    if (base.type === "character" && series.role === "scene") {
      throw new Error("角色扩展加入合集时身份只能是主角或成员");
    }
  }
  const baseImage = base.primaryImage;
  if (!baseImage) {
    throw new Error("原主体没有参考图，无法扩展");
  }

  send({ type: "stage", message: "AI 正在创作新主体设定…" });
  const { system, prompt } = buildExtendPrompt(
    {
      type: base.type,
      name: base.name,
      appearance: base.appearance,
      keywords: base.keywords,
      characterProfile: base.characterProfile,
      personality: base.personality,
      traits: base.traits,
    },
    userHint,
    series
      ? {
          name: series.name,
          intro: series.intro,
          styleName: series.styleName,
          stylePreset: series.stylePreset,
          existing: series.existing,
        }
      : undefined,
  );
  const { object: profile } = await generateObject({
    model: getModel("main"),
    schema: ExtendSubjectSchema,
    system,
    prompt,
  });
  const isCharacter = base.type === "character";
  const characterProfile = isCharacter ? (profile.characterProfile ?? "").trim() : "";
  const personality = isCharacter ? (profile.personality ?? "").trim() : "";
  const traits = isCharacter ? (profile.traits ?? "").trim() : "";
  send({
    type: "profile",
    name: profile.name,
    appearance: profile.appearance,
    keywords: profile.keywords,
    characterProfile,
    personality,
    traits,
  });

  // 生图参考：[合集画风图, 原主体主形象图]（无合集/无画风图时仅原主体图）
  const refs = series?.styleImage ? [series.styleImage, baseImage] : [baseImage];
  send({
    type: "stage",
    message: series?.styleImage
      ? `正在按合集画风生成「${profile.name}」参考图…`
      : `正在生成「${profile.name}」参考图…`,
  });
  const asset = await createAsset({
    type: base.type,
    name: profile.name,
    keywords: profile.keywords,
    characterProfile,
    personality,
    traits,
  });
  const vid = randomUUID();
  const outPath = assetVariantPath(base.type, asset.id, vid);
  try {
    await callImageEdits(buildExtendImagePrompt(base.type, profile), refs, outPath);
  } catch (err) {
    await deleteAsset(asset.id);
    throw err;
  }
  await addAssetVariant(asset.id, {
    id: vid,
    name: "主形象",
    styleId: series?.styleId ?? base.styleId,
    styleName: series?.styleName ?? base.styleName,
    appearance: profile.appearance,
    image: outPath,
  });
  if (series) {
    await replaceAssetLinks(asset.id, [{ seriesId: series.id, role: series.role }]);
  }
  send({
    type: "done",
    assetId: asset.id,
    image: outPath,
    seriesId: series?.id,
    seriesName: series?.name,
    seriesRole: series?.role,
  });
  return asset.id;
}
