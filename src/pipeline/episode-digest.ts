import { generateText } from "ai";

import { db } from "@/lib/db";
import { logTaskEvent } from "@/lib/task-events";
import { getModel } from "@/model-manager";

import { buildDigestPrompt } from "./prompts/digest";

/**
 * 合集剧集发布成功后，基于本集剧本生成一句话"本集简介"，存入 task.episodeDigest。
 * 该简介会被后续剧集在 carryContext 开启时作为"前情回顾"注入剧本 prompt。
 * 幂等：已有简介则跳过。
 */
export async function generateEpisodeDigest(taskId: string): Promise<void> {
  const task = await db.task.findUnique({ where: { taskId } });
  if (!task?.seriesId || !task.scriptJson || task.episodeDigest) return;

  let script: {
    title?: string;
    panels?: Array<{ scene?: string; dialogue?: string; narration?: string }>;
  } = {};
  try {
    script = JSON.parse(task.scriptJson);
  } catch {
    return;
  }
  const title = task.title || script.title || "";
  const lines = (script.panels ?? [])
    .map((p, i) => {
      const narration = (p.narration ?? "").trim();
      return `${i + 1}. ${p.scene ?? ""} ${p.dialogue ?? ""} ${narration === "无" ? "" : narration}`.trim();
    })
    .join("\n");
  if (!title && !lines) return;

  try {
    const { text } = await generateText({
      model: getModel("main"),
      prompt: buildDigestPrompt(title, lines),
    });
    const digest = text
      .trim()
      .replace(/^["""'`\s]+|["""'`\s]+$/g, "")
      .slice(0, 120);
    if (digest) {
      await db.task.update({ where: { taskId }, data: { episodeDigest: digest } });
      await logTaskEvent(taskId, "publishing", "episode_digest", digest);
    }
  } catch (err) {
    console.error("[episode-digest] 生成本集简介失败:", err);
  }
}
