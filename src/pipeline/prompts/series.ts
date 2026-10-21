import type { SeriesContext } from "../../lib/series";

/** 连载合集上下文段落：注入剧本创作 prompt，约束人设/画风/前情衔接 */
export function buildSeriesPromptSection(ctx: SeriesContext, episodeNo: number | null): string {
  const lines: string[] = [];
  const ep = episodeNo != null ? `第 ${episodeNo} 集` : "新一集";
  lines.push(`【连载合集：${ctx.name}】`);
  lines.push(
    `你正在创作《${ctx.name}》的${ep}。请保持与合集的设定、画风和常驻人物一致，故事为该系列的延续。`,
  );
  if (ctx.intro && ctx.intro.trim()) lines.push(`合集设定：${ctx.intro.trim()}`);
  const cast = ctx.episodeCast && ctx.episodeCast.length > 0 ? ctx.episodeCast : ctx.protagonists;
  if (cast.length) {
    lines.push(
      ctx.episodeCast && ctx.episodeCast.length > 0
        ? "本集出场人物（务必使用固定姓名，人设与外观须与参考图保持一致）："
        : "常驻主角（每集固定出场，务必使用固定姓名，人设与外观须与参考图保持一致）：",
    );
    for (const p of cast) {
      const kw = p.keywords ? `（关键词：${p.keywords}）` : "";
      lines.push(`  - ${p.name}${kw}`);
      if (p.characterProfile) lines.push(`      人物设定：${p.characterProfile}`);
      if (p.personality) lines.push(`      性格：${p.personality}`);
      if (p.traits) lines.push(`      小特点：${p.traits}`);
    }
  }
  if (ctx.styleName) lines.push(`本集画风：${ctx.styleName}（已提供参考图，请保持视觉一致）`);
  if (ctx.scenes.length) {
    lines.push(`常设场景（可复用）：${ctx.scenes.map((s) => s.name).join("、")}`);
  }
  if (ctx.recentEpisodes.length) {
    lines.push("前情回顾（避免重复已发生的桥段，保持故事连续性）：");
    for (const e of ctx.recentEpisodes) {
      lines.push(`  - 第 ${e.episodeNo} 集《${e.title || "无标题"}》：${e.digest || "无简介"}`);
    }
    lines.push(`本集是上述剧集之后的新故事，可自然衔接，但不得重复前情中已出现的剧情。`);
  }
  return lines.join("\n");
}
