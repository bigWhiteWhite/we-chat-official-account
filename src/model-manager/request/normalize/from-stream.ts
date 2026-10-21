import type { TransformContext } from "../../catalog/types";
import type {
  UnifiedChatResponse,
  UnifiedFinishReason,
  UnifiedStreamEvent,
  UnifiedUsage,
} from "../types";
import { normalizeContent, normalizeFinishReason, normalizeUsage } from "./shared";

export interface StreamNormalizeState {
  id?: string;
  model?: string;
  contentParts: string[];
  reasoningParts: string[];
  toolCalls: Map<number, { id?: string; name?: string; arguments: string }>;
  finishReason?: UnifiedFinishReason;
  usage?: UnifiedUsage;
  emittedDone: boolean;
}

export function createStreamState(): StreamNormalizeState {
  return {
    contentParts: [],
    reasoningParts: [],
    toolCalls: new Map(),
    emittedDone: false,
  };
}

function buildPartialResponse(
  state: StreamNormalizeState,
  ctx: TransformContext,
): UnifiedChatResponse {
  const toolCalls =
    state.toolCalls.size > 0
      ? [...state.toolCalls.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, t], i) => ({
            id: t.id ?? `call_${i}`,
            name: t.name ?? "",
            arguments: t.arguments,
          }))
      : undefined;
  return {
    id: state.id ?? "",
    model: state.model ?? ctx.ref.modelId,
    content: state.contentParts.join(""),
    reasoning: state.reasoningParts.join("") || undefined,
    toolCalls,
    finishReason: state.finishReason ?? "stop",
    usage: state.usage,
  };
}

/** 单条已解析 SSE data → 0..n 统一事件 */
export function fromStreamChunkOpenAICompat(
  data: unknown,
  ctx: TransformContext,
  state: StreamNormalizeState,
): UnifiedStreamEvent[] {
  if (data === "[DONE]") {
    if (state.emittedDone) {
      return [];
    }
    state.emittedDone = true;
    return [
      {
        type: "done",
        finishReason: state.finishReason ?? "stop",
        response: buildPartialResponse(state, ctx),
      },
    ];
  }

  const o = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (o.id) {
    state.id = String(o.id);
  }
  if (o.model) {
    state.model = String(o.model);
  }

  const events: UnifiedStreamEvent[] = [];
  const choice0 = (o.choices as unknown[])?.[0] as Record<string, unknown> | undefined;
  const delta = (choice0?.delta ?? {}) as Record<string, unknown>;

  const text = normalizeContent(delta.content);
  if (text) {
    state.contentParts.push(text);
    events.push({ type: "delta", text });
  }

  const reasoning = normalizeContent(delta.reasoning_content ?? delta.reasoning);
  if (reasoning) {
    state.reasoningParts.push(reasoning);
    events.push({ type: "reasoning_delta", text: reasoning });
  }

  if (Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls as Record<string, unknown>[]) {
      const idx = Number(tc.index ?? 0);
      const cur = state.toolCalls.get(idx) ?? { arguments: "" };
      if (tc.id) {
        cur.id = String(tc.id);
      }
      const fn = tc.function as Record<string, unknown> | undefined;
      if (fn?.name) {
        cur.name = String(fn.name);
      }
      if (typeof fn?.arguments === "string") {
        cur.arguments += fn.arguments;
      }
      state.toolCalls.set(idx, cur);
      events.push({
        type: "tool_call_delta",
        index: idx,
        id: cur.id,
        name: cur.name,
        argumentsDelta: typeof fn?.arguments === "string" ? fn.arguments : undefined,
      });
    }
  }

  if (choice0?.finish_reason) {
    state.finishReason = normalizeFinishReason(choice0.finish_reason);
  }

  if (o.usage) {
    state.usage = normalizeUsage(o.usage);
    if (state.usage) {
      events.push({ type: "usage", usage: state.usage });
    }
  }

  return events;
}

/** 读取 SSE ReadableStream，逐条产出 data 载荷（含 "[DONE]"） */
export async function* iterateSSEData(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const data = trimmed.slice(5).trim();
        if (!data) {
          continue;
        }
        if (data === "[DONE]") {
          yield "[DONE]";
          continue;
        }
        try {
          yield JSON.parse(data) as unknown;
        } catch {
          /* 跳过非 JSON */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* normalizeOpenAICompatSSE(
  body: ReadableStream<Uint8Array>,
  ctx: TransformContext,
): AsyncGenerator<UnifiedStreamEvent> {
  const state = createStreamState();
  for await (const data of iterateSSEData(body)) {
    const evs = fromStreamChunkOpenAICompat(data, ctx, state);
    for (const e of evs) {
      yield e;
    }
  }
  if (!state.emittedDone) {
    state.emittedDone = true;
    yield {
      type: "done",
      finishReason: state.finishReason ?? "stop",
      response: buildPartialResponse(state, ctx),
    };
  }
}
