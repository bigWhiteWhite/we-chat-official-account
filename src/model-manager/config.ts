import { envOrSetting } from "../lib/settings-store";
import type { ApiType, ImageProtocol, ModelBizType } from "./types";

/** 域主模型 env 变量名（每个域只有一个模型） */
export const MODEL_PRIMARY_ENV: Record<ModelBizType, string> = {
  main: "MODEL_MAIN_PRIMARY",
  mainLight: "MODEL_MAIN_LIGHT_PRIMARY",
  vision: "MODEL_VISION_PRIMARY",
  imageApi: "MODEL_IMAGE_API_PRIMARY",
};

export const isAutoFallbackEnabled = (): boolean => {
  const v = envOrSetting("MODEL_AUTO_FALLBACK")?.trim().toLowerCase();
  if (v === undefined || v === "") {
    return true;
  }
  return v === "1" || v === "true" || v === "yes";
};

export const getHealthTimeoutMs = (): number => {
  const n = Number(envOrSetting("MODEL_HEALTH_TIMEOUT_MS"));
  return Number.isFinite(n) && n > 0 ? n : 12_000;
};

export const getFallbackCooldownMs = (): number => {
  const n = Number(envOrSetting("MODEL_FALLBACK_COOLDOWN_MS"));
  return Number.isFinite(n) && n > 0 ? n : 60_000;
};

export const getPrimaryFromEnv = (biz: ModelBizType): string | undefined => {
  const key = MODEL_PRIMARY_ENV[biz];
  const raw = envOrSetting(key)?.trim();
  return raw || undefined;
};

/** 域级 API 类型 env 变量名（与 MODEL_SETTING_ENV_KEYS 的 MODEL.<biz>.apiType 一致） */
export const MODEL_API_TYPE_ENV: Record<ModelBizType, string> = {
  main: "MODEL_MAIN_API_TYPE",
  mainLight: "MODEL_MAIN_LIGHT_API_TYPE",
  vision: "MODEL_VISION_API_TYPE",
  imageApi: "MODEL_IMAGE_API_API_TYPE",
};

/** 域 API 类型：默认 chat；仅识别 "responses"（大小写不敏感），其余回落 chat */
export function getApiTypeForBiz(biz: ModelBizType): ApiType {
  const raw = envOrSetting(MODEL_API_TYPE_ENV[biz])?.trim().toLowerCase();
  return raw === "responses" ? "responses" : "chat";
}

/** 域级生图协议 env 变量名（与 MODEL_SETTING_ENV_KEYS 的 MODEL.<biz>.imageProtocol 一致） */
export const MODEL_IMAGE_PROTOCOL_ENV: Record<ModelBizType, string> = {
  main: "MODEL_MAIN_IMAGE_PROTOCOL",
  mainLight: "MODEL_MAIN_LIGHT_IMAGE_PROTOCOL",
  vision: "MODEL_VISION_IMAGE_PROTOCOL",
  imageApi: "MODEL_IMAGE_API_IMAGE_PROTOCOL",
};

/** 域生图协议：默认 openai；仅识别 "si-image"（大小写不敏感），其余回落 openai */
export function getImageProtocolForBiz(biz: ModelBizType): ImageProtocol {
  const raw = envOrSetting(MODEL_IMAGE_PROTOCOL_ENV[biz])?.trim().toLowerCase();
  return raw === "si-image" ? "si-image" : "openai";
}
