import type { TagSpec } from "../schema";

/** 内容标签段落：每行「- 名称：说明」，无说明只写名称；空数组返回空串 */
export function formatTagLines(tags: TagSpec[]): string {
  return tags
    .map((t) => {
      const name = t.name.trim();
      if (!name) return "";
      const desc = t.description?.trim();
      return desc ? `- ${name}：${desc}` : `- ${name}`;
    })
    .filter(Boolean)
    .join("\n");
}
