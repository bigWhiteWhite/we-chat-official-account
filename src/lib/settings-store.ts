// 仅服务端使用：本模块导入 @/lib/db，禁止从客户端组件 import。

import { db } from "@/lib/db";

/** 设置键 ↔ env 变量 映射表（单一事实源；GET/PUT payload 组装也用它遍历） */
export const MODEL_SETTING_ENV_KEYS = [
  // 业务域（main / mainLight / vision / imageApi）——统一自定义供应商五要素
  ...(["main", "mainLight", "vision", "imageApi"] as const).flatMap((biz) => {
    const infix = {
      main: "MAIN",
      mainLight: "MAIN_LIGHT",
      vision: "VISION",
      imageApi: "IMAGE_API",
    }[biz];
    return [
      { key: `MODEL.${biz}.primary`, envName: `MODEL_${infix}_PRIMARY`, secret: false },
      { key: `MODEL.${biz}.apiType`, envName: `MODEL_${infix}_API_TYPE`, secret: false },
      {
        key: `MODEL.${biz}.imageProtocol`,
        envName: `MODEL_${infix}_IMAGE_PROTOCOL`,
        secret: false,
      },
      { key: `MODEL.${biz}.baseUrl`, envName: `MODEL_${infix}_BASE_URL`, secret: false },
      { key: `MODEL.${biz}.apiKey`, envName: `MODEL_${infix}_API_KEY`, secret: true },
    ];
  }),
  // 全局 env 网关与降级（域级未配置时的回落；页面「模型配置」Tab 底部全局卡可编辑）
  { key: "MODEL.global.baseUrl", envName: "MODEL_BASE_URL", secret: false },
  { key: "MODEL.global.apiKey", envName: "MODEL_API_KEY", secret: true },
  { key: "MODEL.global.autoFallback", envName: "MODEL_AUTO_FALLBACK", secret: false },
  // 业务字段（运行时被消费者，Task 2A 动态化；DB_FILE/预留字段不进此表，页面只读展示）
  { key: "BUSINESS.appid", envName: "APPID", secret: false },
  { key: "BUSINESS.appsecret", envName: "APPSECRET", secret: true },
  { key: "BUSINESS.author", envName: "AUTHOR", secret: false },
  { key: "BUSINESS.stylePreset", envName: "STYLE_PRESET", secret: false },
  { key: "BUSINESS.narrationInImage", envName: "NARRATION_IN_IMAGE", secret: false },
  { key: "BUSINESS.imageGenConcurrency", envName: "IMAGE_GEN_CONCURRENCY", secret: false },
] as const satisfies ReadonlyArray<{ key: string; envName: string; secret: boolean }>;

const KEY_TO_ENV = new Map<string, string>(MODEL_SETTING_ENV_KEYS.map((e) => [e.key, e.envName]));
const ENV_TO_KEY = new Map<string, string>(MODEL_SETTING_ENV_KEYS.map((e) => [e.envName, e.key]));

type SettingsGlobal = typeof globalThis & {
  __appSettingsCache?: Map<string, string> | null;
  __appSettingsLoad?: Promise<void>;
};

const g = globalThis as SettingsGlobal;

function cache(): Map<string, string> | null {
  return g.__appSettingsCache ?? null;
}

function loadCache(): Promise<void> {
  if (cache()) return Promise.resolve();
  g.__appSettingsLoad ??= (async () => {
    const rows = await db.appSetting.findMany();
    if (!cache()) {
      g.__appSettingsCache = new Map(rows.map((r) => [r.key, r.value]));
    }
  })();
  return g.__appSettingsLoad;
}

/** 确保缓存已从 DB 加载（幂等）；供需要读完整覆盖层的场景（如 payload 组装）显式等待 */
export function ensureSettingsLoaded(): Promise<void> {
  return loadCache();
}

/** 同步读取覆盖层；缓存未加载完成时返回 undefined（等价 env 现状，绝不阻塞模型调用） */
export function getSetting(key: string): string | undefined {
  return cache()?.get(key);
}

/** DB 覆盖 → env 回落；空串视为未设置 */
export function envOrSetting(envName: string): string | undefined {
  const key = ENV_TO_KEY.get(envName);
  const v = key ? cache()?.get(key) : undefined;
  if (v && v.trim() !== "") return v;
  const env = process.env[envName];
  return env && env.trim() !== "" ? env : undefined;
}

/**
 * 保存模型设置。patch 以设置键为索引：
 * - 非空值 → upsert；
 * - undefined → 删除该行（恢复 env 回落）；
 * - 空串 → 对 `*.apiKey` 键表示「不修改」，其余键同 undefined。
 */
export async function setModelSettings(patch: Record<string, string | undefined>): Promise<void> {
  await loadCache();
  const c = cache();
  if (!c) throw new Error("设置缓存初始化失败");
  for (const [key, raw] of Object.entries(patch)) {
    if (!KEY_TO_ENV.has(key)) {
      throw new Error(`未知设置键: ${key}`);
    }
    const value = raw?.trim() ?? "";
    const isApiKey = key.endsWith(".apiKey");
    if (!value && isApiKey) continue; // 空 key = 保留旧值
    if (!value) {
      // 清除覆盖：记录可能尚不存在（该键从未被设置过），删除应视为幂等空操作
      try {
        await db.appSetting.delete({ where: { key } });
      } catch (e) {
        // P2025 = 记录不存在，忽略；其余错误照常抛出
        const err = e as { code?: string; message?: string };
        if (err.code !== "P2025" && !/record.*not.*found|not found/i.test(err.message || ""))
          throw e;
      }
      c.delete(key);
      continue;
    }
    await db.appSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    c.set(key, value);
  }
}

/** 测试用：清缓存（下次 getSetting 前会重新从 DB 加载） */
export function clearSettingsCache(): void {
  g.__appSettingsCache = null;
  g.__appSettingsLoad = undefined;
}

/** API Key 掩码：长度≤4 全掩，否则留后 4 位 */
export function maskValue(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (v.length <= 4) return "****";
  return `****${v.slice(-4)}`;
}
