import { sceneName, uniqueCast, type ComicScript } from "../schema";
import type { AssetType } from "../subjects";

export type MatchAssetRow = {
  id: string;
  type: AssetType;
  name: string;
  appearance: string;
  keywords: string;
};

/** LLM 匹配提示词：剧本人物/主场景/画风 + 资产库条目 → JSON 绑定 */
export function buildMatchPrompt(script: ComicScript, assets: MatchAssetRow[]): string {
  const rows = assets
    .map(
      (a) =>
        `- [${a.id}] ${a.type} / ${a.name} / 外观设定：${a.appearance} / 关键词：${a.keywords}`,
    )
    .join("\n");
  return [
    "你是漫画主体匹配器。根据剧本，从主体库中为每个出场角色、主场景和画风选择最匹配的资产。",
    "规则：",
    "1. assetId 只能取自给定资产 id；没有匹配项时填 null。",
    "2. characters 必须覆盖剧本全部出场角色，name 原样回填。",
    "3. scene.name 填主场景描述（不超过 30 字）。",
    "",
    `剧本标题：${script.title}`,
    `出场角色：${uniqueCast(script).join("、")}`,
    `主场景：${sceneName(script)}`,
    "",
    "主体库：",
    rows || "（空）",
    "",
    '只输出纯 JSON（不要用 markdown 代码块包裹，不要输出 JSON 以外的任何文字），结构：{"style":{"assetId":string|null},"scene":{"name":string,"assetId":string|null},"characters":[{"name":string,"assetId":string|null}]}',
  ].join("\n");
}

/** 扩展流程中的合集上下文（可选）：让新主体与合集设定/画风保持一致、避免角色重复 */
export type ExtendSeriesContext = {
  name: string;
  intro?: string;
  styleName?: string | null;
  stylePreset?: string | null;
  /** 合集已有同类主体（角色/场景；用于避免重名或设定雷同） */
  existing?: Array<{ name: string; characterProfile?: string }>;
};

/** 主体扩展：LLM 依据参考主体 + 用户指令（+ 合集上下文）创作新主体设定 */
export function buildExtendPrompt(
  base: {
    type: AssetType;
    name: string;
    appearance: string;
    keywords: string;
    characterProfile?: string;
    personality?: string;
    traits?: string;
  },
  userHint: string,
  series?: ExtendSeriesContext,
): { system: string; prompt: string } {
  const typeLabel = base.type === "character" ? "角色" : "场景";
  const lines: string[] = [`参考${typeLabel}：${base.name}`];
  if (base.type === "character") {
    if (base.characterProfile?.trim()) lines.push(`参考人物设定：${base.characterProfile}`);
    if (base.personality?.trim()) lines.push(`参考性格：${base.personality}`);
    if (base.traits?.trim()) lines.push(`参考专属小特点：${base.traits}`);
  }
  lines.push(`参考外观设定：${base.appearance}`, `参考关键词：${base.keywords}`);
  if (series) {
    lines.push("", `目标合集：${series.name}`);
    if (series.intro?.trim()) lines.push(`合集设定：${series.intro}`);
    const styleText = [series.styleName, series.stylePreset].filter(Boolean).join(" / ");
    if (styleText) lines.push(`合集画风：${styleText}（新主体外观必须与该画风一致）`);
    const others = (series.existing ?? [])
      .map((c) => (c.characterProfile?.trim() ? `${c.name}（${c.characterProfile}）` : c.name))
      .join("、");
    if (others) {
      lines.push(
        base.type === "character"
          ? `合集已有角色：${others}（新角色不得与它们重名或人设雷同）`
          : `合集已有场景：${others}（新场景不得与它们重名或设定雷同）`,
      );
    }
  }
  lines.push("", `用户指令：${userHint}`, "");
  if (base.type === "character") {
    lines.push(
      "要求：name 突出新主体身份（避免与合集已有角色重名）；appearance 描述外观等可被生图复用的稳定特征（含专属小特点的视觉体现）；keywords 为逗号分隔的检索关键词；characterProfile 用 1-2 句话写人物设定（身份/背景/与合集的关系）；personality 用 3-8 个字概括性格；traits 写 1 个可被画面体现的专属小特点。",
    );
  } else {
    lines.push(
      "要求：name 突出新场景身份（避免与合集已有场景重名）；appearance 描述外观/布局等可被生图复用的稳定特征（画面中不出现角色）；keywords 为逗号分隔的检索关键词。",
    );
  }
  return {
    system:
      "你是漫画资产策划。根据参考主体和用户指令，创作一个新主体的设定，输出严格遵循给定 JSON Schema。",
    prompt: lines.join("\n"),
  };
}

/** 扩展主体的生图提示词（img2img，以原主体图为参考） */
export function buildExtendImagePrompt(
  type: AssetType,
  subject: { name: string; appearance: string },
): string {
  if (type === "character") {
    return `角色三视图参考图（同一角色正面/侧面/背面同框，纯色背景，画风统一；按角色真实物种与体型呈现，人物为人形，动物等保持真实形态、不拟人化成人形）：${subject.name}。外观设定：${subject.appearance}`;
  }
  return `场景参考图（空镜环境设定图，画面中不出现角色，画风统一）：${subject.name}。场景设定：${subject.appearance}`;
}

export type CharacterAppearanceScript = {
  title?: string;
  panels: Array<{ scene: string; character: string; dialogue: string; narration?: string }>;
  outfits?: Record<string, string>;
};

export function buildAppearancesPrompt(
  script: CharacterAppearanceScript,
  names: string[],
): { system: string; prompt: string } {
  const panels = script.panels
    .map((p, i) => {
      const narr = p.narration?.trim() && p.narration !== "无" ? `，说明「${p.narration}」` : "";
      return `第${i + 1}格：画面「${p.scene}」，角色「${p.character}」，台词「${p.dialogue}」${narr}`;
    })
    .join("\n");
  const outfitLines = names
    .map((n) => (script.outfits?.[n]?.trim() ? `  - ${n}：${script.outfits[n].trim()}` : null))
    .filter(Boolean) as string[];
  const outfitSection = outfitLines.length ? `\n本集装扮：\n${outfitLines.join("\n")}` : "";
  return {
    system:
      "你是漫画美术设定师。根据剧本，为指定角色补写稳定、可被生图复用的外观设定，只输出 JSON。",
    prompt: [
      `剧本标题：${script.title ?? ""}`,
      `剧本：\n${panels}`,
      outfitSection,
      ``,
      `需要补全外观的角色：${names.join("、")}`,
      ``,
      "要求：",
      "1. 为每个角色写 appearance，描述可被生图复用的稳定视觉特征（物种与体型、年龄、发型发色、服装、标志性配饰等）。",
      "2. 必须忠实于剧本与给定装扮，不得虚构与剧情矛盾的信息；剧本未明确的可按常理合理补全。",
      "3. 人物按人形呈现，动物/其他生物保持真实形态，不要拟人化成人形或直立行走。",
      "4. 每条 appearance 不超过 120 字，不要输出角色以外的解释文字。",
      ``,
      `只输出纯 JSON（不要用 markdown 代码块包裹），结构：{"appearances": {"角色名": "外观设定"}}`,
    ].join("\n"),
  };
}

/** 画风样图提示词：展示画风视觉特征的示例画面（确认主体前可单独生成） */
export function buildStylePreviewPrompt(preset: string): string {
  return [
    `画风：${preset}，中文漫画。`,
    "风格参考样图：一张展示该画风视觉特征的示例漫画画面（简单场景与一个示例角色即可，无需文字），用作风格参考。",
  ].join("\n");
}

/** 场景参考图提示词：空镜环境设定，画面不出现角色 */
export function buildSceneViewPrompt(name: string, preset: string): string {
  return `场景参考图：空镜环境设定图，画面中不出现角色。画风：${preset}。场景描述：${name}`;
}

/** 角色参考图提示词：三视图 */
export function buildCharacterViewPrompt(
  name: string,
  imagePrompt: string,
  preset: string,
): string {
  return [
    "角色三视图参考图：同一角色正面/侧面/背面同框，纯色背景。按角色本身的物种与体型呈现：人物绘制为人形，动物/其他生物保持其真实形态（例如猫就是猫），不要拟人化成人形或直立行走；仅当设定明确说明为拟人化角色时才按人形表现。",
    `画风：${preset}。`,
    `角色名：${name}${imagePrompt ? `。外观设定：${imagePrompt}` : ""}`,
  ].join("\n");
}
