import type { TransformContext } from "../../catalog/types";
import type { UnifiedChatResponse } from "../types";
import { normalizeFinishReason, normalizeUsage } from "./shared";

/** 解析 OpenAI Responses API 非流式响应 → UnifiedChatResponse */
export function fromResponsesOpenAICompat(
  raw: unknown,
  ctx: TransformContext,
): UnifiedChatResponse {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const output = Array.isArray(o.output) ? (o.output as Array<Record<string, unknown>>) : [];

  let content = "";
  let reasoning = "";
  for (const item of output) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content as Array<Record<string, unknown>>) {
        if (part?.type === "output_text" && typeof part.text === "string") {
          content += part.text;
        }
      }
    } else if (item?.type === "reasoning" && Array.isArray(item.summary)) {
      for (const s of item.summary as Array<Record<string, unknown>>) {
        if (s?.type === "summary_text" && typeof s.text === "string") {
          reasoning += s.text;
        }
      }
    }
  }

  if (typeof o.output_text === "string" && o.output_text.length > 0) {
    content = o.output_text;
  }

  const finishReason = normalizeFinishReason(
    o.status === "completed" ? "stop" : o.status === "incomplete" ? "length" : "error",
  );

  return {
    id: String(o.id ?? ""),
    model: String(o.model ?? ctx.ref.modelId),
    content,
    reasoning: reasoning || undefined,
    finishReason,
    usage: normalizeUsage(o.usage),
  };
}

export function extractResponsesAssistantText(response: UnifiedChatResponse): string {
  const text = response.content.trim();
  if (text) {
    return text;
  }
  throw new Error("responses empty payload（output 无有效 output_text）");
}
