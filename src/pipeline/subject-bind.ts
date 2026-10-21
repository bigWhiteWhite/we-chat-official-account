import path from "node:path";
import { randomUUID } from "node:crypto";

import pLimit from "p-limit";
import pRetry from "p-retry";

import { db } from "@/lib/db";
import {
  addAssetVariant,
  assetVariantPath,
  parseVariants,
  touchUsage,
  type AssetType,
} from "@/lib/assets";
import { getStylePreset, getImageGenConcurrency } from "@/lib/business-settings";
import { chatCompletionForBiz } from "@/model-manager";

import { generateCharacterView, type SubjectPromptOverrides } from "./artist";
import { sceneName } from "./schema";
import { parseTolerantJson } from "./topic";
import { buildAppearancesPrompt, type CharacterAppearanceScript } from "./prompts/subjects";
import { parseTaskReferences, type SubjectBindings, type TaskReferences } from "./subjects";

/**
 * 解析主体绑定并产出 TaskReferences（生图唯一数据源）：
 * - 绑定资产 → 按「显式形象变体 > 本集画风变体 > 主形象」解析参考图；
 *   本集画风缺对应变体时按 主形象外观设定+本集画风 文生图并写回资产变体；
 * - 未绑定   → 角色/画风文生图写入任务目录确定性路径（重确认/重生成时覆盖）；
 *   主场景不再自动文生图，仅使用绑定的场景资产图（未绑定则不传场景参考图）。
 * 每完成一项通过 send 推送事件，供前端实时渲染主体卡；
 * 同时推送 stage 事件，让前端「AI 过程」有时间线可读的内容。
 */

/** 绑定资产按形象变体解析参考图；本集画风缺变体时文生图并写回资产 */
async function resolveVariantImage(
  asset: { id: string; type: string; name: string; variantsJson: string },
  style: { assetId: string | null; preset: string },
  variantId: string | null,
  send: (ev: unknown) => void,
): Promise<string | null> {
  const variants = parseVariants(asset.variantsJson);
  if (variantId) {
    const hit = variants.find((v) => v.id === variantId);
    if (hit?.image) return hit.image;
  }
  const styleHit = style.assetId ? variants.find((v) => v.styleId === style.assetId) : undefined;
  if (styleHit?.image) return styleHit.image;
  // 主场景不再文生图：本集画风缺场景变体时直接回退主形象，不生成新图
  if (asset.type === "scene") return variants[0]?.image ?? null;
  if (style.assetId) {
    const appearance = variants[0]?.appearance?.trim() || asset.name;
    send({
      type: "stage",
      message: `正在按本集画风生成「${asset.name}」的参考图并写回资产库…`,
    });
    const vid = randomUUID();
    const outPath = assetVariantPath(asset.type as AssetType, asset.id, vid);
    const img = await pRetry(
      () => generateCharacterView(asset.name, appearance, style.preset, outPath),
      {
        retries: 1,
      },
    );
    const styleAsset = await db.asset.findUnique({ where: { id: style.assetId } });
    await addAssetVariant(asset.id, {
      id: vid,
      name: styleAsset?.name ? `${styleAsset.name}形象` : "本集画风形象",
      styleId: style.assetId,
      styleName: styleAsset?.name ?? "",
      appearance,
      image: img.path,
    });
    return img.path;
  }
  return variants[0]?.image ?? null;
}

export async function resolveSubjects(
  taskId: string,
  script: CharacterAppearanceScript,
  bindings: SubjectBindings,
  send: (ev: unknown) => void,
  promptOverrides: SubjectPromptOverrides = {},
): Promise<TaskReferences> {
  const fallbackPreset = getStylePreset();
  const boundPreset = bindings.style?.preset?.trim();
  const outDir = path.join("data", "images", taskId, "subjects");

  send({ type: "stage", message: "正在确认画风…" });

  const style: TaskReferences["style"] = {
    assetId: null,
    preset: boundPreset || fallbackPreset,
    image: null,
  };
  if (bindings.style?.assetId) {
    const asset = await db.asset.findUnique({ where: { id: bindings.style.assetId } });
    if (asset) {
      const images = JSON.parse(asset.imagePathsJson) as string[];
      style.assetId = asset.id;
      style.preset = asset.stylePreset?.trim() || boundPreset || fallbackPreset;
      style.image = images[0] ?? null;
      await touchUsage(asset.id);
    }
  } else {
    // 复用主体确认步骤已预生成的画风样图（未绑定画风资产时）
    const prevTask = await db.task.findUnique({ where: { taskId } });
    if (prevTask?.referencePathsJson) {
      const prev = parseTaskReferences(prevTask.referencePathsJson);
      if (prev.kind === "new" && prev.refs.style?.image) {
        style.image = prev.refs.style.image;
        if (prev.refs.style.preset?.trim()) style.preset = prev.refs.style.preset.trim();
      }
    }
  }
  send({
    type: "subject",
    kind: "style",
    source: style.assetId ? "asset" : style.image ? "generated" : "default",
    name: style.assetId ? "画风" : style.preset,
    image: style.image,
  });

  // 主场景不再单独文生图：参考图仅来自绑定的场景资产（含本集画风自动变体）；
  // 未绑定场景资产时该格不传场景参考图，场景由分格提示词里的画面描述表达。
  // name 优先取用户在确认主体时编辑的说明描述（仅存储/展示，不参与生图），留空回退首格画面。
  const scene: TaskReferences["scene"] = {
    assetId: null,
    name: bindings.scene.name?.trim() || sceneName(script),
    image: null,
  };
  if (bindings.scene.assetId) {
    send({ type: "stage", message: `正在确认主场景「${scene.name}」…` });
    const asset = await db.asset.findUnique({ where: { id: bindings.scene.assetId } });
    if (asset) {
      scene.assetId = asset.id;
      scene.image = await resolveVariantImage(asset, style, bindings.scene.variantId ?? null, send);
      await touchUsage(asset.id);
    }
  }
  send({
    type: "subject",
    kind: "scene",
    source: scene.assetId ? "asset" : "default",
    name: scene.name,
    image: scene.image,
  });

  const characters: TaskReferences["characters"] = Array.from({
    length: bindings.characters.length,
  });

  // 未绑定且无覆盖/装扮的角色，一次性让 LLM 依据剧本补全外观，避免三视图 prompt 只有角色名
  const needAppearance = bindings.characters
    .filter(
      (b) =>
        !b.assetId &&
        !promptOverrides.characters?.[b.name]?.trim() &&
        !(script.outfits?.[b.name]?.trim() ?? ""),
    )
    .map((b) => b.name);
  const appearanceMap: Record<string, string> = {};
  if (needAppearance.length > 0) {
    send({ type: "stage", message: "AI 正在补全角色外观设定…" });
    try {
      const { system, prompt } = buildAppearancesPrompt(script, needAppearance);
      const raw = await chatCompletionForBiz(
        "mainLight",
        [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        { responseFormat: { type: "json_object" } },
      );
      const data = parseTolerantJson<{ appearances?: Record<string, unknown> }>(raw);
      for (const [name, value] of Object.entries(data.appearances ?? {})) {
        const text = typeof value === "string" ? value.trim() : "";
        if (text) appearanceMap[name] = text.slice(0, 200);
      }
    } catch (err) {
      console.error("[subjects] 角色外观补全失败，降级为无外观设定：", err);
    }
  }

  const limit = pLimit(getImageGenConcurrency());

  await Promise.all(
    bindings.characters.map((binding, i) =>
      limit(async () => {
        const entry: TaskReferences["characters"][number] = {
          name: binding.name,
          assetId: null,
          image: null,
        };
        send({ type: "stage", message: `正在确认角色「${entry.name}」…` });
        if (binding.assetId) {
          const asset = await db.asset.findUnique({ where: { id: binding.assetId } });
          if (asset) {
            entry.assetId = asset.id;
            entry.image = await resolveVariantImage(asset, style, binding.variantId ?? null, send);
            await touchUsage(asset.id);
          }
        }
        if (!entry.image) {
          send({
            type: "subject",
            kind: "character",
            index: i,
            source: "generating",
            name: entry.name,
            image: null,
          });
          const appearance =
            script.outfits?.[entry.name]?.trim() || appearanceMap[entry.name] || "";
          entry.appearance = appearance || null;
          const img = await pRetry(
            () =>
              generateCharacterView(
                entry.name,
                appearance,
                style.preset,
                path.join(outDir, `c${i}.png`),
                undefined,
                { promptOverride: promptOverrides.characters?.[entry.name] },
              ),
            { retries: 1 },
          );
          entry.image = img.path;
        }
        characters[i] = entry;
        send({
          type: "subject",
          kind: "character",
          index: i,
          source: entry.assetId ? "asset" : "generated",
          name: entry.name,
          image: entry.image,
        });
      }),
    ),
  );

  return { style, scene, characters };
}
