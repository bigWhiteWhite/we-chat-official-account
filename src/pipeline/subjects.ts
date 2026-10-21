import { z } from "zod";

import type { ComicScript } from "./schema";
import { sceneName, splitNames, uniqueCast } from "./schema";

export type AssetType = "character" | "scene" | "style";

export type SubjectBinding = { name: string; assetId: string | null; variantId?: string | null };

export type SubjectBindings = {
  style?: { assetId: string | null; preset?: string };
  scene: SubjectBinding;
  characters: SubjectBinding[];
};

export type TaskReferences = {
  style?: { assetId: string | null; preset: string; image: string | null };
  scene: { assetId: string | null; name: string; image: string | null };
  characters: Array<{
    name: string;
    assetId: string | null;
    image: string | null;
    /** 确认主体时 LLM 补全的外观设定（供三视图参考图 prompt 复用；旧任务可能缺失） */
    appearance?: string | null;
  }>;
};

export const ExtendSubjectSchema = z.object({
  name: z.string().max(20),
  appearance: z.string().max(200),
  keywords: z.string().max(100),
  /** 人物设定（角色扩展时 LLM 产出） */
  characterProfile: z.string().max(200).optional(),
  /** 性格（角色扩展时 LLM 产出） */
  personality: z.string().max(60).optional(),
  /** 专属小特点（角色扩展时 LLM 产出） */
  traits: z.string().max(60).optional(),
});
export type ExtendSubject = z.infer<typeof ExtendSubjectSchema>;

/** 该格出场角色对应的参考图（名字模糊匹配，按 refs 顺序去重） */
export function panelCharacterRefs(refs: TaskReferences, panelCharacter: string): string[] {
  const names = splitNames(panelCharacter);
  const out: string[] = [];
  for (const character of refs.characters) {
    if (!character.image) continue;
    const hit = names.some(
      (n) => n === character.name || character.name.includes(n) || n.includes(character.name),
    );
    if (hit && !out.includes(character.image)) out.push(character.image);
  }
  return out;
}

/** 单格参考图集合：[画风样图?, 该格出场角色…, 场景图?] */
export function buildPanelRefs(
  script: ComicScript,
  refs: TaskReferences,
  panelIndex: number,
): string[] {
  const panel = script.panels[panelIndex];
  if (!panel) return [];
  const out: string[] = [];
  if (refs.style?.image) out.push(refs.style.image);
  out.push(...panelCharacterRefs(refs, panel.character));
  if (refs.scene.image) out.push(refs.scene.image);
  return out;
}

/**
 * 解析 referencePathsJson：
 * 新格式含 characters 数组；旧格式为扁平 { slot: "path" }；否则 none。
 */
export function parseTaskReferences(
  json: string | null | undefined,
):
  | { kind: "new"; refs: TaskReferences }
  | { kind: "legacy"; paths: Record<string, string> }
  | { kind: "none" } {
  if (!json) return { kind: "none" };
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return { kind: "none" };
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return { kind: "none" };
  const o = obj as Record<string, unknown>;
  if (Array.isArray(o.characters)) {
    const characters = (o.characters as Array<Record<string, unknown>>).map((c) => ({
      name: typeof c.name === "string" ? c.name : "",
      assetId: typeof c.assetId === "string" ? c.assetId : null,
      image: typeof c.image === "string" ? c.image : null,
      appearance:
        typeof c.appearance === "string" && c.appearance.trim() ? c.appearance.trim() : null,
    }));
    const s = (o.scene ?? {}) as Record<string, unknown>;
    const scene = {
      assetId: typeof s.assetId === "string" ? s.assetId : null,
      name: typeof s.name === "string" ? s.name : "",
      image: typeof s.image === "string" ? s.image : null,
    };
    const styleRaw = o.style as Record<string, unknown> | undefined;
    const style = styleRaw
      ? {
          assetId: typeof styleRaw.assetId === "string" ? styleRaw.assetId : null,
          preset: typeof styleRaw.preset === "string" ? styleRaw.preset : "",
          image: typeof styleRaw.image === "string" ? styleRaw.image : null,
        }
      : undefined;
    return { kind: "new", refs: { style, scene, characters } };
  }
  const paths: Record<string, string> = {};
  for (const [key, value] of Object.entries(o)) {
    if (typeof value === "string" && value) paths[key] = value;
  }
  return { kind: "legacy", paths };
}

/** 生图风格文本：主体库 preset 优先，缺省回退 env */
export function stylePresetFor(refs: TaskReferences | null | undefined, fallback: string): string {
  const preset = refs?.style?.preset?.trim();
  return preset ? preset : fallback;
}

export type LlmMatch = {
  style?: { assetId: string | null } | null;
  scene: { name: string; assetId: string | null };
  characters: Array<{ name: string; assetId: string | null }>;
};

/** 清洗 LLM 匹配结果：过滤无效 assetId；角色以剧本人物表为准（缺的补 null） */
export function normalizeMatch(
  matched: LlmMatch,
  script: ComicScript,
  validIds: Set<string>,
): SubjectBindings {
  const pick = (v: string | null | undefined): string | null => (v && validIds.has(v) ? v : null);
  const byName = (name: string) =>
    matched.characters.find(
      (c) => c.name === name || c.name.includes(name) || name.includes(c.name),
    );
  const characters = uniqueCast(script).map((name) => {
    const found = byName(name);
    return { name, assetId: found ? pick(found.assetId) : null };
  });
  const bindings: SubjectBindings = {
    scene: { name: sceneName(script), assetId: pick(matched.scene?.assetId ?? null) },
    characters,
  };
  const styleId = pick(matched.style?.assetId ?? null);
  if (styleId) bindings.style = { assetId: styleId };
  return bindings;
}
