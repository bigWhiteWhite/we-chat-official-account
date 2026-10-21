// 仅服务端使用（依赖 settings-store → @/lib/db）。

import type { ModelBizType } from "@/model-manager/types";
import {
  ensureSettingsLoaded,
  envOrSetting,
  maskValue,
  setModelSettings,
} from "@/lib/settings-store";
import {
  getAppId,
  getAppSecret,
  getAuthor,
  getImageGenConcurrency,
  getNarrationInImage,
  getStylePreset,
} from "@/lib/business-settings";

const BIZ_LIST = [
  "main",
  "mainLight",
  "vision",
  "imageApi",
] as const satisfies readonly ModelBizType[];
const BIZ_ENV_INFIX: Record<ModelBizType, string> = {
  main: "MAIN",
  mainLight: "MAIN_LIGHT",
  vision: "VISION",
  imageApi: "IMAGE_API",
};

export type ModelSettingDomain = {
  apiType: "chat" | "responses";
  /** 生图协议：仅 imageApi 域消费，其余域存默认值不生效 */
  imageProtocol: "openai" | "si-image";
  primary: string;
  baseUrl: string;
  apiKeyMasked: string | null;
  hasApiKey: boolean;
};

export type BusinessSettingsView = {
  appid: string;
  appsecretMasked: string | null;
  hasAppsecret: boolean;
  author: string;
  stylePreset: string;
  narrationInImage: boolean;
  imageGenConcurrency: number;
  dbFile: string;
  reserved: {
    comicsDir: string;
    inboxDir: string;
    topicSources: string;
    panelsMaxPerChapter: string;
    dailyBudgetCny: string;
    maxImagePerTask: string;
  };
};

export type BusinessSettingsSave = {
  appid: string;
  appsecret: string;
  author: string;
  stylePreset: string;
  narrationInImage: boolean;
  imageGenConcurrency: number;
};

export type AppSettingsPayload = {
  domains: Record<ModelBizType, ModelSettingDomain>;
  global: {
    autoFallback: boolean;
    baseUrl: string;
    apiKeyMasked: string | null;
    hasApiKey: boolean;
  };
  business: BusinessSettingsView;
};

/** 保存用 payload：密钥字段明文，空串=不修改；其余空串=清除覆盖 */
export type AppSettingsSavePayload = {
  domains: Record<
    ModelBizType,
    {
      apiType: "chat" | "responses";
      imageProtocol: "openai" | "si-image";
      primary: string;
      baseUrl: string;
      apiKey: string;
    }
  >;
  global: { autoFallback: boolean; baseUrl: string; apiKey: string };
  business: BusinessSettingsSave;
};

function parseAutoFallback(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  if (v === undefined || v === "") return true;
  return v === "true" || v === "1" || v === "yes";
}

function parseApiType(raw: string | undefined): "chat" | "responses" {
  return (raw ?? "").trim().toLowerCase() === "responses" ? "responses" : "chat";
}

function parseImageProtocol(raw: string | undefined): "openai" | "si-image" {
  return (raw ?? "").trim().toLowerCase() === "si-image" ? "si-image" : "openai";
}

function domainView(biz: ModelBizType) {
  const infix = BIZ_ENV_INFIX[biz];
  const apiKey = envOrSetting(`MODEL_${infix}_API_KEY`);
  return {
    apiType: parseApiType(envOrSetting(`MODEL_${infix}_API_TYPE`)),
    imageProtocol: parseImageProtocol(envOrSetting(`MODEL_${infix}_IMAGE_PROTOCOL`)),
    primary: envOrSetting(`MODEL_${infix}_PRIMARY`) ?? "",
    baseUrl: envOrSetting(`MODEL_${infix}_BASE_URL`) ?? "",
    apiKeyMasked: maskValue(apiKey) ?? null,
    hasApiKey: Boolean(apiKey),
  };
}

/** 业务字段视图：可编辑项经 Task 2A getter（DB 覆盖 → env → 默认值）；dbFile/reserved 只读展示 */
function businessView(): BusinessSettingsView {
  const appsecret = getAppSecret();
  return {
    appid: getAppId(),
    appsecretMasked: maskValue(appsecret) ?? null,
    hasAppsecret: Boolean(appsecret),
    author: getAuthor(),
    stylePreset: getStylePreset(),
    narrationInImage: getNarrationInImage(),
    imageGenConcurrency: getImageGenConcurrency(),
    // 运行时只读：db 单例已绑定 DB_FILE，改动无意义，仅展示
    dbFile: process.env.DB_FILE ?? "./data/comics.db",
    // 当前版本代码未消费的预留字段，仅展示，不进保存 payload
    reserved: {
      comicsDir: process.env.COMICS_DIR ?? "",
      inboxDir: process.env.INBOX_DIR ?? "",
      topicSources: process.env.TOPIC_SOURCES ?? "",
      panelsMaxPerChapter: process.env.PANELS_MAX_PER_CHAPTER ?? "",
      dailyBudgetCny: process.env.DAILY_BUDGET_CNY ?? "",
      maxImagePerTask: process.env.MAX_IMAGE_PER_TASK ?? "",
    },
  };
}

/** 组装当前生效配置（DB 覆盖 → .env 回落 → 默认值），密钥一律掩码 */
export async function buildAppSettingsPayload(): Promise<AppSettingsPayload> {
  await ensureSettingsLoaded();
  const domains = {} as Record<ModelBizType, ModelSettingDomain>;
  for (const biz of BIZ_LIST) domains[biz] = domainView(biz);

  const globalApiKey = envOrSetting("MODEL_API_KEY");

  return {
    domains,
    global: {
      autoFallback: parseAutoFallback(envOrSetting("MODEL_AUTO_FALLBACK")),
      baseUrl: envOrSetting("MODEL_BASE_URL") ?? "",
      apiKeyMasked: maskValue(globalApiKey) ?? null,
      hasApiKey: Boolean(globalApiKey),
    },
    business: businessView(),
  };
}

/**
 * 保存设置。apiKey / appsecret 约定：空串 = 不修改（保留旧值）；非空 = 覆盖。
 * 其余字段空串 = 清除覆盖（回落到 .env / 默认值）。
 */
export async function saveAppSettingsPayload(payload: AppSettingsSavePayload): Promise<void> {
  const patch: Record<string, string | undefined> = {};
  for (const biz of BIZ_LIST) {
    const d = payload.domains[biz];
    patch[`MODEL.${biz}.apiType`] = d.apiType === "responses" ? "responses" : "chat";
    patch[`MODEL.${biz}.imageProtocol`] = d.imageProtocol === "si-image" ? "si-image" : "openai";
    patch[`MODEL.${biz}.primary`] = d.primary.trim();
    patch[`MODEL.${biz}.baseUrl`] = d.baseUrl.trim();
    if (d.apiKey.trim() !== "") patch[`MODEL.${biz}.apiKey`] = d.apiKey.trim();
  }
  patch["MODEL.global.baseUrl"] = payload.global.baseUrl.trim();
  patch["MODEL.global.autoFallback"] = payload.global.autoFallback ? "true" : "false";
  if (payload.global.apiKey.trim() !== "")
    patch["MODEL.global.apiKey"] = payload.global.apiKey.trim();
  // 业务字段：appsecret 空串=不修改；其余空串=清除覆盖
  patch["BUSINESS.appid"] = payload.business.appid.trim();
  if (payload.business.appsecret.trim() !== "")
    patch["BUSINESS.appsecret"] = payload.business.appsecret.trim();
  patch["BUSINESS.author"] = payload.business.author.trim();
  patch["BUSINESS.stylePreset"] = payload.business.stylePreset.trim();
  patch["BUSINESS.narrationInImage"] = payload.business.narrationInImage ? "true" : "false";
  const conc = Math.floor(payload.business.imageGenConcurrency);
  patch["BUSINESS.imageGenConcurrency"] = Number.isFinite(conc) && conc > 0 ? String(conc) : "2";
  await setModelSettings(patch);
}
