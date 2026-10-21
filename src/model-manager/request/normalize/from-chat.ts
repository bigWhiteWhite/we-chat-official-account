import type { TransformContext } from "../../catalog/types";
import type { UnifiedChatResponse, UnifiedError } from "../types";
import {
  normalizeContent,
  normalizeFinishReason,
  normalizeToolCalls,
  normalizeUsage,
} from "./shared";

export function fromChatOpenAICompat(raw: unknown, ctx: TransformContext): UnifiedChatResponse {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const choice0 = (o.choices as unknown[])?.[0] as Record<string, unknown> | undefined;
  const msg = (choice0?.message ?? {}) as Record<string, unknown>;

  const content = normalizeContent(msg.content);
  const reasoning = normalizeContent(msg.reasoning_content ?? msg.reasoning);

  return {
    id: String(o.id ?? ""),
    model: String(o.model ?? ctx.ref.modelId),
    content,
    reasoning: reasoning || undefined,
    toolCalls: normalizeToolCalls(msg.tool_calls),
    finishReason: normalizeFinishReason(choice0?.finish_reason ?? choice0?.native_finish_reason),
    usage: normalizeUsage(o.usage),
  };
}

export function fromHttpErrorOpenAICompat(status: number, bodyText: string): UnifiedError {
  let vendor: unknown;
  let message = bodyText.slice(0, 500);
  let code = `vendor_http_${status}`;
  try {
    vendor = JSON.parse(bodyText);
    const err = (vendor as { error?: { message?: string; code?: string; type?: string } }).error;
    if (err?.message) {
      message = err.message;
    }
    if (err?.code) {
      code = String(err.code);
    } else if (err?.type) {
      code = String(err.type);
    }
  } catch {
    /* text body */
  }

  const retryable =
    status === 429 ||
    status >= 500 ||
    /timeout|overloaded|rate.?limit/i.test(message) ||
    status === 401;
  // 401 retryable：跨网关可降级（与 fallback auth 策略一致）
  return { code, message, httpStatus: status, retryable, vendor };
}

export function extractAssistantText(response: UnifiedChatResponse): string {
  const text = response.content.trim();
  if (text) {
    return text;
  }
  // 部分模型把有效输出放在 reasoning；业务 chat 需要字符串时仍优先 content
  throw new Error("chat completions empty payload（choices 无有效 content）");
}
