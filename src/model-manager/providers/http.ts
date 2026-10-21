import { resolveGatewayConfig } from "../catalog/gateways";
import type { ApiType, ImageProtocol, ModelRef } from "../types";
import { createCompatProvider, type CompatProvider } from "./openai-compat";
import type { WrapLMModel } from "./utils";

export interface GatewayHttpConfig {
  gateway: string;
  baseUrl: string;
  apiKey: string;
  apiType: ApiType;
  imageProtocol: ImageProtocol;
}

/** 域网关 HTTP 凭证；该域未配端点返回 null，由调用方报错提示换配置。 */
export function getGatewayHttpConfig(gateway: string): GatewayHttpConfig | null {
  const cfg = resolveGatewayConfig(gateway);
  if (!cfg) {
    return null;
  }
  return {
    gateway,
    baseUrl: cfg.baseUrl.replace(/\/$/, ""),
    apiKey: cfg.apiKey,
    apiType: cfg.apiType,
    imageProtocol: cfg.imageProtocol,
  };
}

export function createLanguageModel(ref: ModelRef, opts?: { thinking?: boolean }): WrapLMModel {
  const cfg = resolveGatewayConfig(ref.gateway);
  if (!cfg) {
    throw new Error(
      `${ref.gateway} 未配置端点：请在 /settings 页「模型配置」或 .env 填写 MODEL_<域>_BASE_URL + MODEL_<域>_API_KEY（模型 ${ref.id}）`,
    );
  }
  if (cfg.kind === "image") {
    throw new Error(`${ref.gateway} 网关仅用于 imageApi（/images/*），不支持 chat LanguageModel`);
  }
  const provider: CompatProvider = createCompatProvider(cfg, {
    baseUrl: cfg.baseUrl.replace(/\/$/, ""),
    apiKey: cfg.apiKey,
  });
  const thinking = opts?.thinking ?? true;
  return thinking ? provider.createThinkingModel(ref.modelId) : provider.createModel(ref.modelId);
}
