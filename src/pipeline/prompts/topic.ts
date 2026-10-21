import { DEFAULT_THEME_HINT } from "@/lib/themes";

import type { TagSpec } from "../schema";
import { formatTagLines } from "./tags";

/** 选题 prompt：内容标签说明即创作要求（无标签回落默认题材方向）；LLM 批量自创候选，输出 JSON */
export function buildTopicPrompt(count: number, tags: TagSpec[]): string {
  const tagLines = formatTagLines(tags);
  const spec = tagLines
    ? `须符合以下内容标签的要求（标签说明即创作要求）：\n${tagLines}`
    : `题材方向：${DEFAULT_THEME_HINT}`;
  return `生成 ${count + 2} 个中文漫画选题，${spec}，每个 ≤20 字，输出 JSON：{"topics": ["...", "..."]}`;
}
