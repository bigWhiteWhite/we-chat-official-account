import { envOrSetting } from "@/lib/settings-store";
import { getApiTypeForBiz, getImageProtocolForBiz } from "../config";
import type { ApiType, ImageProtocol, ModelBizType } from "../types";

/**
 * 网关 = 业务域对应的一个 OpenAI 兼容端点，全部来自配置（/settings 页或 .env），无内置网关表。
 * 取数顺序：MODEL_<域>_BASE_URL / MODEL_<域>_API_KEY → 全局 MODEL_BASE_URL / MODEL_API_KEY；
 * key 缺省用占位 "env"（适配无鉴权的本地端点）。接新厂商只改配置，不改代码。
 */
export type GatewayKind = "chat" | "image" | "both";

export interface GatewayConfig {
  id: string;
  baseUrl: string;
  apiKey: string;
  kind: GatewayKind;
  apiType: ApiType;
  /** 仅 imageApi 域消费；其余域保持默认 openai */
  imageProtocol: ImageProtocol;
}

/** 业务域 → env 变量中缀（与 MODEL_PRIMARY_ENV 保持一致） */
export const BIZ_ENV_INFIX: Record<ModelBizType, string> = {
  main: "MAIN",
  mainLight: "MAIN_LIGHT",
  vision: "VISION",
  imageApi: "IMAGE_API",
};

/** 域级网关：域未配端点（也无全局兜底）时返回 null。 */
export function getEnvGatewayConfig(biz: ModelBizType): GatewayConfig | null {
  const infix = BIZ_ENV_INFIX[biz];
  const baseUrl =
    envOrSetting(`MODEL_${infix}_BASE_URL`)?.trim() || envOrSetting("MODEL_BASE_URL")?.trim() || "";
  if (!baseUrl) {
    return null;
  }
  return {
    id: biz,
    baseUrl,
    apiKey:
      envOrSetting(`MODEL_${infix}_API_KEY`)?.trim() ||
      envOrSetting("MODEL_API_KEY")?.trim() ||
      "env",
    kind: biz === "imageApi" ? "image" : "chat",
    apiType: getApiTypeForBiz(biz),
    imageProtocol: getImageProtocolForBiz(biz),
  };
}

/** 报错文案用：域名 → 该去改哪两项配置。 */
export function endpointEnvHint(gateway: string): string {
  const infix = BIZ_ENV_INFIX[gateway as ModelBizType];
  return infix ? `MODEL_${infix}_BASE_URL / MODEL_${infix}_API_KEY` : "MODEL_<域>_BASE_URL";
}

/** 按网关 id（即业务域名）查端点配置；非域名返回 null。 */
export function resolveGatewayConfig(id: string): GatewayConfig | null {
  if (id in BIZ_ENV_INFIX) {
    return getEnvGatewayConfig(id as ModelBizType);
  }
  return null;
}
