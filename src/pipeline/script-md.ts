import { clampScript, ComicScriptSchema, type ComicScript } from "./schema";
import { parseTolerantJson } from "./topic";

/** 剧本 Markdown 输出模板已迁至 ./prompts/writer.ts（SCRIPT_MD_TEMPLATE），与本文件解析器格式须同步修改。 */

/** Markdown 解析出的剧本草稿（source/source_url 由调用方补齐） */
export type ScriptMarkdownDraft = {
  title: string;
  theme: string;
  intro: string;
  target_panels: number;
  panels: Array<{ scene: string; character: string; dialogue: string; narration: string }>;
  punchline: string;
  outfits: Record<string, string>;
  risk_tags: string[];
};

/** 解析装扮行：「角色名：服装描述」逗号分隔 → Record；"无"/空 → 空对象 */
export function parseOutfitLine(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const seg of raw.split(/[,，、;；]+/)) {
    const m = seg.match(/^\s*([^:：]+?)\s*[:：]\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim();
    if (!key || !val || val === "无") continue;
    out[key] = val;
  }
  return out;
}

const LABEL_ALIASES: Record<string, string[]> = {
  标题: ["标题", "Title"],
  主题: ["主题", "Topic"],
  导语: ["导语", "引言", "Intro"],
  爆点: ["爆点", "金句", "Punchline"],
  装扮: ["装扮", "服装", "Outfit"],
  风险: ["风险"],
  画面: ["画面"],
  角色: ["角色"],
  台词: ["台词"],
  说明: ["说明", "旁白", "Narration"],
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 从 Markdown 段落中取「label：value」首行（兼容全/半角冒号、可选冒号、# 标题前缀与英文别名） */
function pickLine(text: string, label: string): string | null {
  const aliases = LABEL_ALIASES[label] ?? [label];
  const alt = aliases.map(escapeRe).join("|");
  const re = new RegExp(`^\\s*(?:#{1,6}\\s*)?(?:${alt})(?:\\s*[:：]\\s*|\\s+)(.+)$`, "im");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

/** 取正文中第一条非标签、非分格、非空行（标题缺失时的回退值） */
function firstContentLine(raw: string): string | null {
  const metaRe =
    /^(?:#{1,6}\s*)?(?:标题|主题|导语|引言|爆点|金句|装扮|服装|风险|画面|角色|台词|说明|旁白|Title|Topic|Intro|Punchline|Outfit|Narration)/i;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^(?:-{3,}|={3,}|#{1,6}\s*$)/.test(trimmed)) continue;
    if (/第\s*\d+\s*格/.test(trimmed)) continue;
    if (metaRe.test(trimmed)) continue;
    return trimmed;
  }
  return null;
}

/** 解析剧本 Markdown → 剧本对象（不含 source/source_url）；分格不足抛错，标题/爆点缺失宽容回退 */
export function parseScriptMarkdown(raw: string): ScriptMarkdownDraft {
  const theme = (pickLine(raw, "主题") ?? "").slice(0, 20);
  const intro = (pickLine(raw, "导语") ?? "").slice(0, 120);
  const riskRaw = pickLine(raw, "风险") ?? "";

  const starts: Array<{ index: number; end: number }> = [];
  const panelRe = /第\s*(\d+)\s*格/g;
  let m: RegExpExecArray | null;
  while ((m = panelRe.exec(raw)) !== null) {
    starts.push({ index: m.index, end: m.index + m[0].length });
  }
  starts.sort((a, b) => a.index - b.index);

  const panels: Array<{ scene: string; character: string; dialogue: string; narration: string }> =
    [];
  for (let i = 0; i < starts.length; i++) {
    const body = raw.slice(starts[i].end, i + 1 < starts.length ? starts[i + 1].index : raw.length);
    const line = (label: string) => pickLine(body, label) ?? "";
    panels.push({
      scene: line("画面"),
      character: line("角色"),
      dialogue: line("台词"),
      narration: line("说明"),
    });
  }

  if (panels.length < 4) {
    throw new Error(`剧本分格不足（${panels.length} < 4）`);
  }
  const riskTags = riskRaw
    .split(/[,，、;；\s]+/)
    .map((t) => t.trim())
    .filter((t) => t && t !== "无");

  const title = pickLine(raw, "标题") ?? firstContentLine(raw) ?? (theme || "未命名");
  const punchline = pickLine(raw, "爆点") ?? "";
  const outfits = parseOutfitLine(pickLine(raw, "装扮") ?? "");

  return {
    title,
    theme,
    intro,
    target_panels: panels.length,
    panels,
    punchline,
    outfits,
    risk_tags: riskTags,
  };
}

/** 截断超长字段并规范化结构，供 schema 校验（schema max 仅作最后防线） */
function normalizeForSchema(base: Record<string, unknown>): Record<string, unknown> {
  const str = (v: unknown, max: number, fallback = ""): string =>
    typeof v === "string" ? v.slice(0, max) : fallback;
  const panelsRaw: unknown[] = Array.isArray(base.panels) ? base.panels : [];
  const panels = panelsRaw.slice(0, 40).map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    return {
      scene: typeof o.scene === "string" ? o.scene : "",
      character: str(o.character, 50),
      dialogue: str(o.dialogue, 300),
      narration: str(o.narration, 200),
    };
  });
  const targetPanels = Number(base.target_panels);
  const punchline = str(base.punchline, 40);
  return {
    ...base,
    title: str(base.title, 32),
    theme: str(base.theme, 20, "未命名"),
    intro: str(base.intro, 120),
    punchline: punchline === "无" ? "" : punchline,
    panels,
    target_panels:
      Number.isInteger(targetPanels) && targetPanels >= 4 && targetPanels <= 40
        ? targetPanels
        : Math.min(40, Math.max(4, panels.length)),
    risk_tags: Array.isArray(base.risk_tags)
      ? base.risk_tags.map((t) => String(t)).slice(0, 20)
      : [],
  };
}

/**
 * 解析 LLM 输出为 ComicScript：
 * - 以 { 开头或含 "title" 键 → 按宽容 JSON 解析；
 * - 否则按 Markdown 模板解析；
 * - 最后经 ComicScriptSchema 校验 + clampScript 兜底。
 */
export function parseScriptOutput(
  raw: string,
  source: ComicScript["source"],
  sourceUrl = "",
): ComicScript {
  let base: Record<string, unknown>;
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("```json") || /"title"\s*:/.test(trimmed)) {
    try {
      base = parseTolerantJson<Record<string, unknown>>(raw);
    } catch {
      throw new Error("剧本 JSON 解析失败");
    }
  } else {
    base = parseScriptMarkdown(raw);
  }
  const candidate: Record<string, unknown> = {
    theme: "未命名",
    target_panels: 4,
    risk_tags: [],
    ...base,
    source,
    source_url: sourceUrl,
  };
  const parsed = ComicScriptSchema.safeParse(normalizeForSchema(candidate));
  if (!parsed.success) {
    throw new Error(`剧本格式校验失败：${parsed.error.issues[0]?.message ?? "schema 未通过"}`);
  }
  return clampScript(parsed.data);
}
