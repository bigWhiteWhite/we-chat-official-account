import { generateText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { parseVariants } from "@/lib/assets";
import { db } from "@/lib/db";
import { getModel } from "@/model-manager";
import { applySeriesLock } from "@/lib/series";
import type { ComicScript } from "@/pipeline/schema";
import { sceneName, uniqueCast } from "@/pipeline/schema";
import { buildMatchPrompt, type MatchAssetRow } from "@/pipeline/prompts/subjects";
import { normalizeMatch } from "@/pipeline/subjects";

const MatchSchema = z.object({
  style: z.object({ assetId: z.string().nullable() }).nullable().optional(),
  scene: z.object({ name: z.string(), assetId: z.string().nullable() }),
  characters: z.array(z.object({ name: z.string(), assetId: z.string().nullable() })),
});

/** 宽容解析：剥掉 markdown 代码块围栏，取最外层 {...} 后按 schema 校验。 */
function parseMatchOutput(raw: string): z.infer<typeof MatchSchema> {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("LLM 输出中未找到 JSON 对象");
  }
  const data: unknown = JSON.parse(text.slice(start, end + 1));
  const result = MatchSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error("主体匹配结果校验失败：" + (issue ? issue.message : "结构不合法"));
  }
  return result.data;
}

/** LLM 语义匹配：剧本人物/主场景/画风 → 资产库绑定（库为空时返回全新生成绑定）；解析失败自动重试。 */
export async function POST(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const task = await db.task.findUnique({ where: { taskId } });
  if (!task?.scriptJson) {
    return NextResponse.json({ error: "任务暂无剧本" }, { status: 400 });
  }
  const script = JSON.parse(task.scriptJson) as ComicScript;
  const assets = await db.asset.findMany({ orderBy: { createdAt: "desc" } });

  if (assets.length === 0) {
    const bindings = {
      scene: { name: sceneName(script), assetId: null },
      characters: uniqueCast(script).map((name) => ({ name, assetId: null })),
    };
    return NextResponse.json({
      bindings: await applySeriesLock(bindings, task.seriesId, task.styleAssetId),
    });
  }

  const matchAssets: MatchAssetRow[] = assets.map((a) => ({
    id: a.id,
    type: a.type as MatchAssetRow["type"],
    name: a.name,
    appearance: parseVariants(a.variantsJson)[0]?.appearance ?? "",
    keywords: a.keywords,
  }));

  const maxAttempts = 3;
  let lastErr: unknown;
  let matched: z.infer<typeof MatchSchema> | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await generateText({
        model: getModel("main"),
        prompt:
          buildMatchPrompt(script, matchAssets) +
          (attempt > 1
            ? "\n\n注意：你上一次的输出无法解析。请只输出纯 JSON，不要用 markdown 代码块包裹，不要输出任何解释文字。"
            : ""),
      });
      matched = parseMatchOutput(result.text);
      break;
    } catch (err) {
      lastErr = err;
      console.error(`[match-subjects] 第 ${attempt}/${maxAttempts} 次解析失败:`, err);
    }
  }
  if (!matched) {
    const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
    return NextResponse.json({ error: `主体匹配失败：${message}` }, { status: 502 });
  }

  const validIds = new Set(assets.map((a) => a.id));
  const bindings = normalizeMatch(matched, script, validIds);
  return NextResponse.json({
    bindings: await applySeriesLock(bindings, task.seriesId, task.styleAssetId),
  });
}
