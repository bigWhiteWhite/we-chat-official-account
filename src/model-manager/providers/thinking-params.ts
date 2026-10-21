/**
 * 思考相关 vendor patch：委托 catalog profile，禁止在此增长模型 if-else。
 */

export type ThinkingBodyPatch = {
  thinking?: { type: "enabled" | "adaptive" | "disabled" };
  reasoning_effort?: string;
};

/** 把 patch 合并进已解析的 chat body（原地修改） */
export function applyThinkingBodyPatch(
  body: Record<string, unknown>,
  patch: ThinkingBodyPatch | null,
): void {
  if (!patch) {
    return;
  }
  if (patch.thinking) {
    body.thinking = patch.thinking;
  }
  if (patch.reasoning_effort) {
    body.reasoning_effort = patch.reasoning_effort;
  }
}
