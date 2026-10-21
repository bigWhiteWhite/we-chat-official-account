/**
 * Agent LanguageModel fetch 层：按网关 + modelId 应用 profile vendor patch。
 * 与 toVendorRequest 共用 catalog，禁止在各 provider 内写模型 if。
 */
import { resolveModelProfile } from "../catalog";
import type { ModelGatewayId } from "../types";
import { applyThinkingBodyPatch, type ThinkingBodyPatch } from "./thinking-params";

export function applyProfileVendorBodyPatch(
  body: Record<string, unknown>,
  gateway: ModelGatewayId,
): void {
  const modelId = typeof body.model === "string" ? body.model.trim() : "";
  if (!modelId) {
    return;
  }
  try {
    const profile = resolveModelProfile({ gateway, modelId });
    const patch = (profile.resolveVendorThinking?.(modelId) ?? null) as ThinkingBodyPatch | null;
    if (!patch) {
      delete body.thinking;
      delete body.reasoning_effort;
      return;
    }
    applyThinkingBodyPatch(body, patch);
    // 仅 gemini 等少数 profile 声明 reasoning_effort；其余 thinking 型模型
    // 若 body 里残留了上层 providerOptions 注入的 reasoning_effort，必须清掉，
    // 否则透传给不支持该字段的端点（多数 OpenAI 兼容端点会报 Unexpected reasoning effort）。
    if (patch.reasoning_effort == null) {
      delete body.reasoning_effort;
    }
  } catch {
    /* 未注册：不改 body */
  }
}
