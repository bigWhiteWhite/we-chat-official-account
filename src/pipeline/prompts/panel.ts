import type { ComicPanel, ComicScript } from "../schema";
import { splitNames } from "../schema";

/** 本集装扮提示行：按出场角色列出「装扮（角色名）：…」（无则空数组） */
function outfitLinesFor(script: Pick<ComicScript, "outfits">, panels: ComicPanel[]): string[] {
  const outfits = script.outfits ?? {};
  const names: string[] = [];
  for (const panel of panels) {
    for (const n of splitNames(panel.character)) {
      if (outfits[n] && !names.includes(n)) names.push(n);
    }
  }
  return names.map((n) => `装扮（${n}）：${outfits[n]}`);
}

const OUTFIT_CONSISTENCY =
  "同一角色的面部/发型/体型/标志性配饰必须与参考图保持一致；如指定了本集装扮，服装以装扮设定为准（可换装，脸不可变）。";

/** 单格分镜规范：以专业漫画分镜师视角设计构图/视线/层次/线条/明暗/气泡（题材中立，随内容自适应） */
const PANEL_CRAFT_GUIDE = `## 单格分镜与绘制规范
你是一位专业漫画分镜师，每一格都是一个分镜镜头（不是单纯一张插画），请从专业分镜师的角度设计本格画面：
- 构图机位：根据内容选择最具表现力的镜头——景别（特写/近景/中景/全景）与角度（平视/仰角/俯角）；仰角强化威严压迫，俯角强化弱小无助，动态激烈时可倾斜构图增强张力。
- 视觉重心：全格只有一个第一眼焦点（核心动作或表情所在），严禁多个重点抢视线；用光线、人物视线、手势、动势线把读者视线引向气泡台词。
- 空间层次：前景遮挡物增加纵深、中景承载核心动作、背景交代环境，三层分明；角色不得悬浮在无意义背景中。
- 剪影与线条：姿态轮廓一眼可读（只剩剪影也能看出谁在做什么），动作有重量感；外轮廓线粗、内部细节线细，按内容需要使用速度线、集中线、效果线。
- 明暗氛围：主光源统一，明暗层次区分主体/背景/特效并突出焦点，适度留白给画面呼吸感。
- 气泡规范：气泡不得遮挡角色面部与视觉重心，沿阅读顺序摆放；引线清晰指向说话人，多人对话不得歧义；形状跟随情绪——普通对话圆形、大喊锯齿、内心独白虚线、回忆云朵。
- 瞬间定格：选取动作冲突或情绪最强的一帧，而非动作的起始或结束。`;

/**
 * 单格完整提示词（唯一实现：批量生图/单格重生成/任务预览/前端弹窗兜底共用）。
 * 纯函数、无服务端依赖；preset 与 narrationInImage 由调用方显式传入（服务端传 env 值）。
 */
export function buildPanelPrompt(
  script: Pick<ComicScript, "panels" | "outfits">,
  panel: ComicPanel,
  index: number,
  preset: string,
  layout?: string,
  narrationInImage = false,
): string {
  const lines = [
    PANEL_CRAFT_GUIDE,
    `画风：${preset} | 中文漫画，对话文字直接渲染进气泡，字体清晰无错别字。`,
    layout === "tall"
      ? `竖版长图布局，第 ${index + 1} 格为自上而下排列中的一帧。`
      : `横版漫画图布局，第 ${index + 1} 格为从左到右排列中的一帧。`,
    `第 ${index + 1} 格：`,
    `- 画面：${panel.scene}`,
    `- 角色：${panel.character}`,
    `- 气泡台词「${panel.dialogue}」`,
    ...outfitLinesFor(script, [panel]),
    OUTFIT_CONSISTENCY,
  ];
  // 旁白是否渲染进画面由 NARRATION_IN_IMAGE 控制（横竖版一致，默认不渲染）；"无"表示该格无旁白
  const narration = (panel.narration ?? "").trim();
  if (narrationInImage && narration && narration !== "无") {
    lines.push(`- 旁白文字「${narration}」（渲染为格顶或格底的说明条文字，不遮挡角色与视觉重心）`);
  }
  return lines.join("\n");
}
