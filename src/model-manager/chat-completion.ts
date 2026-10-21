import { resolveModelProfile } from "./catalog";
import type { ModelProfile } from "./catalog/types";
import { endpointEnvHint } from "./catalog/gateways";
import { isAutoFallbackEnabled } from "./config";
import { classifyFailure, isRetryableFailure, withModelFallback } from "./fallback";
import { getModelChain } from "./registry";
import { resolveModelRef } from "./resolve";
import { getGatewayHttpConfig } from "./providers/http";
import {
  extractAssistantText,
  fromChatOpenAICompat,
  fromHttpErrorOpenAICompat,
} from "./request/normalize/from-chat";
import {
  extractResponsesAssistantText,
  fromResponsesOpenAICompat,
} from "./request/normalize/from-responses";
import { normalizeOpenAICompatSSE } from "./request/normalize/from-stream";
import { toResponsesRequest } from "./request/transform/to-responses";
import { CapabilityMismatchError } from "./request/errors";
import { toVendorRequest } from "./request/transform/to-vendor";
import type { UnifiedChatRequest, UnifiedMessage, UnifiedStreamEvent } from "./request/types";
import type { ModelBizType, ModelRef } from "./types";

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
}

function toUnifiedMessages(messages: ChatCompletionMessage[]): UnifiedMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

/**
 * 调用前能力校验：按请求形态推导必需能力，profile 显式声明 false 时报错换模型
 * （不发 HTTP 请求，避免吃 400）。capabilities 未声明的能力不过滤（未知不误杀）。
 * profile 表当前为空（无内置厂商 profile），故实际只有 standardProfile 无能力限制。
 */
export function assertProfileCapabilities(
  ref: ModelRef,
  profile: ModelProfile,
  req: UnifiedChatRequest,
): void {
  const caps = profile.capabilities;
  if (!caps) {
    return;
  }
  const needsVision = req.messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"),
  );
  if (needsVision && caps.vision === false) {
    throw new CapabilityMismatchError(ref.id, "vision");
  }
  const needsJson = req.responseFormat !== undefined && req.responseFormat.type !== "text";
  if (needsJson && caps.jsonMode === false) {
    throw new CapabilityMismatchError(ref.id, "jsonMode");
  }
}

function buildUnified(
  messages: ChatCompletionMessage[],
  ref: ModelRef,
  opts?: {
    temperature?: number;
    maxTokens?: number;
    extensions?: UnifiedChatRequest["extensions"];
    stream?: boolean;
    responseFormat?: UnifiedChatRequest["responseFormat"];
  },
): UnifiedChatRequest {
  return {
    modelRef: ref.id,
    messages: toUnifiedMessages(messages),
    temperature: opts?.temperature ?? 0.2,
    maxTokens: opts?.maxTokens ?? 8192,
    stream: opts?.stream ?? false,
    extensions: opts?.extensions,
    responseFormat: opts?.responseFormat,
  };
}

/**
 * 按业务域走 auto 降级的 OpenAI 兼容 chat/completions，返回 assistant 文本。
 * 经 toVendorRequest / fromChat 隔离厂商结构。
 */
export async function chatCompletionForBiz(
  biz: ModelBizType,
  messages: ChatCompletionMessage[],
  opts?: {
    fetchImpl?: typeof fetch;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    extensions?: UnifiedChatRequest["extensions"];
    responseFormat?: UnifiedChatRequest["responseFormat"];
  },
): Promise<string> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  return withModelFallback(biz, async ({ ref }) => {
    const http = getGatewayHttpConfig(ref.gateway);
    if (!http) {
      throw new Error(
        `${ref.gateway} 域未配置端点：请在 /settings 页或 .env 填写 ${endpointEnvHint(ref.gateway)}（模型 ${ref.id}）`,
      );
    }

    const profile = resolveModelProfile(ref);
    const unified = buildUnified(messages, ref, opts);
    assertProfileCapabilities(ref, profile, unified);
    const useResponses = http.apiType === "responses";
    const { body } = useResponses
      ? toResponsesRequest(unified, ref)
      : toVendorRequest(unified, ref);
    const url = useResponses ? `${http.baseUrl}/responses` : `${http.baseUrl}/chat/completions`;
    const init: RequestInit = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${http.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    };
    if (opts?.timeoutMs && opts.timeoutMs > 0) {
      init.signal = AbortSignal.timeout(opts.timeoutMs);
    }

    const res = await fetchImpl(url, init);
    const text = await res.text();

    if (!res.ok) {
      const err = fromHttpErrorOpenAICompat(res.status, text);
      throw new Error(`chat completions failed HTTP ${res.status}: ${err.message}`);
    }

    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`chat completions returned non-JSON: ${text.slice(0, 200)}`);
    }

    const ctx = { ref, profile, stream: false as const };
    const unifiedRes = useResponses
      ? fromResponsesOpenAICompat(json, ctx)
      : fromChatOpenAICompat(json, ctx);
    return useResponses
      ? extractResponsesAssistantText(unifiedRes)
      : extractAssistantText(unifiedRes);
  });
}

/**
 * 流式 chat：产出 UnifiedStreamEvent。
 * 开流前失败按降级策略处理（链当前每域一项）；开流后失败只 yield error。
 */
export async function* streamChatForBiz(
  biz: ModelBizType,
  messages: ChatCompletionMessage[],
  opts?: {
    fetchImpl?: typeof fetch;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    extensions?: UnifiedChatRequest["extensions"];
  },
): AsyncGenerator<UnifiedStreamEvent> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const auto = isAutoFallbackEnabled();
  const chain = getModelChain(biz).map(resolveModelRef);

  for (let i = 0; i < chain.length; i++) {
    const ref = chain[i]!;
    const http = getGatewayHttpConfig(ref.gateway);
    if (!http) {
      if (i === chain.length - 1) {
        yield {
          type: "error",
          error: {
            code: "gateway_unconfigured",
            message: `${ref.gateway} 域未配置端点：请在 /settings 页或 .env 填写 ${endpointEnvHint(ref.gateway)}（模型 ${ref.id}）`,
            retryable: true,
          },
        };
      }
      continue;
    }

    const profile = resolveModelProfile(ref);
    const ctx = { ref, profile, stream: true as const };
    const unified = buildUnified(messages, ref, { ...opts, stream: true });
    // 当前无 Responses 流式调用方；若命中 responses 网关直接抛错，避免静默走错端点
    if (http.apiType === "responses") {
      throw new Error(`流式调用暂不支持 Responses 协议（模型 ${ref.id}）`);
    }
    try {
      assertProfileCapabilities(ref, profile, unified);
    } catch (err) {
      if (!(err instanceof CapabilityMismatchError)) {
        throw err;
      }
      if (i === chain.length - 1) {
        yield {
          type: "error",
          error: { code: "capability", message: err.message, retryable: true },
        };
        return;
      }
      console.warn(`[model-manager] skip biz=${biz} model=${ref.id}: ${err.message}`);
      continue;
    }
    const { body } = toVendorRequest(unified, ref);

    let res: Response;
    try {
      const init: RequestInit = {
        method: "POST",
        headers: {
          Authorization: `Bearer ${http.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      };
      if (opts?.timeoutMs && opts.timeoutMs > 0) {
        init.signal = AbortSignal.timeout(opts.timeoutMs);
      }
      res = await fetchImpl(`${http.baseUrl}/chat/completions`, init);
    } catch (err) {
      const kind = classifyFailure(err);
      if (!auto || !isRetryableFailure(kind) || i === chain.length - 1) {
        yield {
          type: "error",
          error: {
            code: kind,
            message: err instanceof Error ? err.message : String(err),
            retryable: isRetryableFailure(kind),
          },
        };
        return;
      }
      console.warn(`[model-manager] stream attempt failed biz=${biz} model=${ref.id} kind=${kind}`);
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      const err = fromHttpErrorOpenAICompat(res.status, text);
      if (!auto || !err.retryable || i === chain.length - 1) {
        yield { type: "error", error: err };
        return;
      }
      console.warn(
        `[model-manager] stream HTTP fail biz=${biz} model=${ref.id} status=${res.status}`,
      );
      continue;
    }

    if (!res.body) {
      yield {
        type: "error",
        error: { code: "empty_stream", message: "stream response missing body", retryable: true },
      };
      return;
    }

    if (i > 0) {
      console.warn(`[model-manager] stream fallback ok biz=${biz} to=${ref.id}`);
    }

    yield* normalizeOpenAICompatSSE(res.body, ctx);
    return;
  }
}
