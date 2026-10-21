/** 业务功能域（按职责分组，不按供应商） */
export type ModelBizType = "main" | "mainLight" | "vision" | "imageApi";

/**
 * 网关 id = 业务域名（main / mainLight / vision / imageApi），一个域一个端点。
 * 合法性由运行时校验（resolve.ts），不再是编译期封闭联合。
 */
export type ModelGatewayId = string;

export interface ModelRef {
  /** 完整引用，如 main/glm-5.3 */
  id: string;
  gateway: ModelGatewayId;
  modelId: string;
}

export type FailureKind =
  | "network"
  | "timeout"
  | "gateway_5xx"
  | "rate_limit"
  | "empty_payload"
  | "auth"
  | "client_4xx"
  | "safety"
  | /** 调用前能力过滤：域主模型缺 vision/jsonMode 等必需能力 */ "capability"
  | "unknown";

export interface GetModelOptions {
  /** 默认 true；标题等轻量场景传 false */
  thinking?: boolean;
}

/** 模型调用协议：chat=OpenAI Chat Completions（/chat/completions），responses=OpenAI Responses API（/responses） */
export type ApiType = "chat" | "responses";

/**
 * 生图协议：openai=OpenAI Images（/images/generations + /images/edits）；
 * si-image=TokenHub/混元私有 /wand/si-image/generation（文生图 JSON，图生图带 base64 images[]）。
 */
export type ImageProtocol = "openai" | "si-image";
