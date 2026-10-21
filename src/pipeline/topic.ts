import { createHash } from "node:crypto";

import pRetry from "p-retry";

import { db } from "@/lib/db";
import { chatCompletionForBiz } from "@/model-manager";

import { buildTopicPrompt } from "./prompts/topic";
import type { TagSpec } from "./schema";

export type PickedTopic = { text: string; source: "self-made" };

/** 梗库指纹：trim + 小写后 sha256，避免大小写/首尾空格造成的伪重复 */
export function hashTopic(text: string): string {
  return createHash("sha256").update(text.trim().toLowerCase()).digest("hex");
}

/** 容忍 LLM 在 json_object 模式下仍输出的 ```json 围栏与前后杂散文本 */
export function parseTolerantJson<T>(raw: string): T {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = (fenced?.[1] ?? text).trim();
  if (!fenced) {
    const start = body.search(/[[{]/);
    const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      body = body.slice(start, end + 1);
    }
  }
  return JSON.parse(body) as T;
}

/**
 * MVP 选题：LLM 批量自创候选 → 30 天梗库去重 → 落库返回。
 * 多要 2 个候选，保证去重后仍尽量凑够 count 个。
 * LLM 超时/格式错误共重试 3 次（需求 9.2）。
 */
export async function pickTopics(count: number, tags: TagSpec[]): Promise<PickedTopic[]> {
  const prompt = buildTopicPrompt(count, tags);
  const parsed = await pRetry(
    async () => {
      const raw = await chatCompletionForBiz("mainLight", [{ role: "user", content: prompt }], {
        responseFormat: { type: "json_object" },
        temperature: 0.9,
      });
      return parseTolerantJson<{ topics?: string[] }>(raw);
    },
    { retries: 2 },
  );
  const candidates = (parsed.topics ?? []).slice(0, count + 2);

  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const recent = await db.topic.findMany({
    where: { usedAt: { gte: cutoff } },
    select: { hash: true },
  });
  const seen = new Set(recent.map((r) => r.hash));

  const picked: PickedTopic[] = [];
  for (const text of candidates) {
    if (picked.length >= count) break;
    const h = hashTopic(text);
    if (seen.has(h)) continue;
    seen.add(h);
    await db.topic.create({ data: { text, source: "self-made", hash: h } });
    picked.push({ text, source: "self-made" });
  }
  return picked;
}
