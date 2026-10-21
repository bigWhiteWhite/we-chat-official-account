/**
 * OpenAI 兼容供应商预设（纯数据，前后端共用，禁止 import env/db/node:*）。
 * 所有供应商统一走「自定义端点」通道：baseUrl/apiKey/modelId 存到 MODEL.<域>.*，
 * 主模型存裸 modelId（绑定该域端点，见 model-manager 域主模型解析）。
 * 预设仅作快速填充（预填 Base URL + 建议模型名），不改变落库结构。
 */

/** 模型调用协议：chat=Chat Completions（/chat/completions），responses=Responses API（/responses） */
export type ApiType = "chat" | "responses";

/** API 类型下拉选项（UI 枚举，仅两项） */
export const API_TYPE_OPTIONS: ReadonlyArray<{ value: ApiType; label: string; hint: string }> = [
  { value: "chat", label: "Chat Completions", hint: "调用 /chat/completions" },
  { value: "responses", label: "Responses API", hint: "调用 /responses" },
];

/** 生图协议：openai=OpenAI Images（/images/generations + /images/edits），si-image=TokenHub/混元私有 /wand/si-image/generation */
export type ImageProtocol = "openai" | "si-image";

/** 生图协议下拉选项（仅 imageApi 域卡展示） */
export const IMAGE_PROTOCOL_OPTIONS: ReadonlyArray<{
  value: ImageProtocol;
  label: string;
  hint: string;
}> = [
  { value: "openai", label: "OpenAI Images", hint: "调用 /images/generations 与 /images/edits" },
  {
    value: "si-image",
    label: "SI-Image（TokenHub / 混元）",
    hint: "调用 /wand/si-image/generation，参考图走 base64",
  },
];

export interface ProviderPreset {
  id: string;
  label: string;
  kind: "chat" | "image" | "both";
  defaultBaseUrl: string;
  auth: "required" | "optional";
  knownModels: string[];
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek（官方）",
    kind: "chat",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    auth: "required",
    knownModels: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "openai",
    label: "OpenAI（官方）",
    kind: "both",
    defaultBaseUrl: "https://api.openai.com/v1",
    auth: "required",
    knownModels: ["gpt-4o", "gpt-4o-mini", "gpt-image-1"],
  },
  {
    id: "moonshot",
    label: "Moonshot / Kimi（官方）",
    kind: "chat",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    auth: "required",
    knownModels: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  },
  {
    id: "qwen",
    label: "通义千问 Qwen（百炼）",
    kind: "both",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    auth: "required",
    knownModels: ["qwen-plus", "qwen-max", "qwen-vl-plus"],
  },
  {
    id: "zhipu",
    label: "智谱 GLM（官方）",
    kind: "chat",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    auth: "required",
    knownModels: ["glm-4-plus", "glm-4-flash", "glm-4v-plus"],
  },
  {
    id: "minimax",
    label: "MiniMax（官方）",
    kind: "chat",
    defaultBaseUrl: "https://api.minimaxi.com/v1",
    auth: "required",
    knownModels: ["abab6.5s-chat", "abab7-chat"],
  },
  {
    id: "custom",
    label: "自定义（任意 OpenAI 兼容端点）",
    kind: "both",
    defaultBaseUrl: "https://",
    auth: "required",
    knownModels: [],
  },
];

/**
 * 按 Base URL 反推预设 id（仅用于 UI 展示/高亮，不写库）。
 * 精确匹配（忽略尾部斜杠）命中预设则返回其 id，否则返回 "custom"。
 */
export function inferProviderId(baseUrl: string): string {
  const norm = (s: string) => s.trim().replace(/\/+$/, "");
  const target = norm(baseUrl);
  if (!target) return "custom";
  const match = PROVIDER_PRESETS.find(
    (p) => p.id !== "custom" && norm(p.defaultBaseUrl) === target,
  );
  return match ? match.id : "custom";
}
