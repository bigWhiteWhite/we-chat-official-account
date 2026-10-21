// 仅服务端使用：业务配置读取（DB 覆盖层 → env 回落）。禁止从客户端组件 import。

import { envOrSetting } from "./settings-store";

const BOOL_TRUE = new Set(["1", "true", "yes"]);

export function getAppId(): string {
  return envOrSetting("APPID") ?? "";
}
export function getAppSecret(): string {
  return envOrSetting("APPSECRET") ?? "";
}
export function getAuthor(): string {
  return envOrSetting("AUTHOR") ?? "";
}
export function getStylePreset(): string {
  return envOrSetting("STYLE_PRESET") ?? "简约线条+低饱和色块+扁平卡通";
}
export function getNarrationInImage(): boolean {
  const v = envOrSetting("NARRATION_IN_IMAGE")?.trim().toLowerCase();
  return BOOL_TRUE.has(v ?? "");
}
export function getImageGenConcurrency(): number {
  const n = Number(envOrSetting("IMAGE_GEN_CONCURRENCY"));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2;
}
