import type { UnifiedFinishReason } from "../types";

export function normalizeContent(content: unknown): string {
  if (content == null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === "string") {
          return p;
        }
        if (p && typeof p === "object" && typeof (p as { text?: string }).text === "string") {
          return (p as { text: string }).text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

export function normalizeFinishReason(raw: unknown): UnifiedFinishReason {
  const s = String(raw ?? "").toLowerCase();
  if (s === "stop" || s === "end_turn" || s === "finished") {
    return "stop";
  }
  if (s === "length" || s === "max_tokens") {
    return "length";
  }
  if (s === "tool_calls" || s === "function_call") {
    return "tool_calls";
  }
  if (s === "content_filter" || s === "safety") {
    return "content_filter";
  }
  if (!s) {
    return "unknown";
  }
  return "unknown";
}

export function normalizeUsage(u: unknown): import("../types").UnifiedUsage | undefined {
  if (!u || typeof u !== "object") {
    return undefined;
  }
  const o = u as Record<string, unknown>;
  const prompt = Number(o.prompt_tokens ?? o.input_tokens ?? 0);
  const completion = Number(o.completion_tokens ?? o.output_tokens ?? 0);
  const total = Number(o.total_tokens ?? prompt + completion);
  const cachedRaw =
    (o.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens ??
    o.cached_tokens;
  const cached = Number(cachedRaw);
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
    ...(Number.isFinite(cached) ? { cachedTokens: cached } : {}),
  };
}

export function normalizeToolCalls(raw: unknown): import("../types").UnifiedToolCall[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined;
  }
  return raw.map((t, i) => {
    const o = t as Record<string, unknown>;
    const fn = (o.function as Record<string, unknown> | undefined) ?? o;
    return {
      id: String(o.id ?? `call_${i}`),
      name: String(fn.name ?? ""),
      arguments:
        typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
    };
  });
}
