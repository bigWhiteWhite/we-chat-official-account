import type { ModelProfile } from "../types";

/**
 * 标准 OpenAI 兼容兜底 profile：profile 表未命中的模型（当前即全部模型）使用。
 * 只做标准字段映射，不注入 thinking 等非标参数；capabilities 不声明（未知模型不做能力过滤，避免误杀）。
 */
export const standardProfile: ModelProfile = {
  match: {},
  extensionKey: "standard",
  extensionSchema: { type: "object", properties: {}, additionalProperties: false },
  fieldMap: [
    { from: "temperature", to: "temperature" },
    { from: "topP", to: "top_p" },
    { from: "maxTokens", to: "max_tokens" },
    { from: "responseFormat", to: "response_format" },
    { from: "streamOptions", to: "stream_options", whenStream: true },
  ],
};
