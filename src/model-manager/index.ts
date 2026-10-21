import { getActiveModelRef } from "./fallback";
import { createLanguageModel } from "./providers/http";
import type { GetModelOptions, ModelBizType, ModelRef } from "./types";
import type { WrapLMModel } from "./providers/utils";

export type {
  ApiType,
  ImageProtocol,
  ModelBizType,
  ModelGatewayId,
  ModelRef,
  GetModelOptions,
  FailureKind,
} from "./types";
export { getPrimaryFromEnv, getApiTypeForBiz, getImageProtocolForBiz } from "./config";
export { endpointEnvHint } from "./catalog/gateways";
export { resolveModelRef } from "./resolve";
export { getModelChain, getPrimaryRef } from "./registry";
export {
  withModelFallback,
  getActiveModelRef,
  clearModelFallbackState,
  classifyFailure,
  isRetryableFailure,
  ModelFallbackAggregateError,
  type WithModelFallbackContext,
} from "./fallback";
export { testModelConnection, listModels, type TestModelParams } from "./health";
export { getGatewayHttpConfig } from "./providers/http";
export type { GatewayHttpConfig } from "./providers/http";
export {
  chatCompletionForBiz,
  streamChatForBiz,
  assertProfileCapabilities,
  type ChatCompletionMessage,
} from "./chat-completion";
export { resolveModelProfile } from "./catalog";
export type {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedStreamEvent,
  UnifiedError,
  UnifiedMessage,
} from "./request/types";

/**
 * 业务唯一入口：按业务域取配置的 LanguageModel（每域只有一个主模型）。
 * Agent 构造时调用；失败分类与重试策略见 withModelFallback。
 */
export function getModel(biz: ModelBizType, opts?: GetModelOptions): WrapLMModel {
  return createLanguageModel(getActiveModelRef(biz), { thinking: opts?.thinking });
}

/** 当前域主模型引用（含 域/modelId） */
export function getModelRef(biz: ModelBizType): ModelRef {
  return getActiveModelRef(biz);
}
