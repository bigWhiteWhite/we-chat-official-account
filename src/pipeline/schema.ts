import { z } from "zod";

export const PanelSchema = z.object({
  scene: z.string(),
  character: z.string().max(50),
  dialogue: z.string().max(300),
  narration: z.string().max(200).optional(),
});

export const ComicScriptSchema = z.object({
  title: z.string().max(32),
  source: z.enum(["self-made", "user-outline", "user-script"]),
  source_url: z.string().url().optional().or(z.literal("")),
  theme: z.string().max(20),
  target_panels: z.number().int().min(4).max(40),
  panels: z.array(PanelSchema).min(4).max(40),
  punchline: z.string().max(40),
  /** 整篇导语：正文开头的引导段（草稿可覆盖） */
  intro: z.string().max(120).optional(),
  risk_tags: z.array(z.string()).default([]),
  /** 每集角色装扮：角色名 → 服装描述（固定形象 + 每集换装） */
  outfits: z.record(z.string(), z.string()).optional(),
});

export type ComicPanel = z.infer<typeof PanelSchema>;
export type ComicScript = z.infer<typeof ComicScriptSchema>;

/** 内容标签（替代旧题材方向/类别）：description 即 LLM 行为说明书，注入选题/剧本 prompt */
export type TagSpec = { name: string; description?: string };

/** 本地硬约束兜底：LLM 超长字段截断（B-4） */
export function clampScript(s: ComicScript): ComicScript {
  return {
    ...s,
    title: s.title.slice(0, 32),
    panels: s.panels.map((p) => ({
      scene: p.scene,
      character: p.character.slice(0, 50),
      dialogue: p.dialogue.slice(0, 300),
      narration: p.narration?.slice(0, 200),
    })),
    punchline: s.punchline.slice(0, 40),
    intro: s.intro?.slice(0, 120),
  };
}

/** 拆分"杨过、小龙女"/"杨过, 小龙女"这类角色字段为名字数组 */
export function splitNames(raw: string): string[] {
  return raw
    .split(/[,，、;；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 剧本出场角色（去重、保序） */
export function uniqueCast(script: ComicScript): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const panel of script.panels) {
    for (const name of splitNames(panel.character)) {
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}

/** 主场景 = 首格画面描述（只依赖 panels，接受结构化的剧本子集） */
export function sceneName(script: { panels: Array<{ scene: string }> }): string {
  return script.panels[0]?.scene ?? "";
}
