import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearModelFallbackState,
  getModelChain,
  getPrimaryFromEnv,
  resolveModelRef,
  withModelFallback,
} from "@/model-manager";

describe("model-manager registry", () => {
  const keys = [
    "MODEL_MAIN_PRIMARY",
    "MODEL_MAIN_LIGHT_PRIMARY",
    "MODEL_AUTO_FALLBACK",
    "MODEL_FALLBACK_COOLDOWN_MS",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    clearModelFallbackState();
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    clearModelFallbackState();
  });

  it("域主模型即候选链唯一一项", () => {
    process.env.MODEL_MAIN_LIGHT_PRIMARY = "mainLight/deepseek-v4-flash";
    expect(getModelChain("mainLight")).toEqual(["mainLight/deepseek-v4-flash"]);
  });

  it("主模型写未知网关前缀 → 解析报错", () => {
    process.env.MODEL_MAIN_PRIMARY = "deepseek-official/x";
    expect(() => getModelChain("main")).toThrow(/未知网关前缀/);
  });

  it("域内未配置主模型 → 报错提示变量名与配置入口", () => {
    let msg = "";
    try {
      getModelChain("main");
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err);
    }
    expect(msg).toMatch(/业务域 main 未配置主模型/);
    expect(msg).toMatch(/MODEL_MAIN_PRIMARY/);
    expect(msg).toMatch(/\/settings/);
  });

  it("唯一主模型失败时直接抛错，不静默切换", async () => {
    process.env.MODEL_FALLBACK_COOLDOWN_MS = "0";
    process.env.MODEL_MAIN_LIGHT_PRIMARY = "mainLight/glm-5.3-flash";
    const calls: string[] = [];
    await expect(
      withModelFallback("mainLight", async ({ ref }) => {
        calls.push(ref.id);
        throw new Error("502 bad gateway");
      }),
    ).rejects.toThrow("502 bad gateway");
    expect(calls).toEqual(["mainLight/glm-5.3-flash"]);
  });

  it("非法模型引用被拒绝", () => {
    expect(() => resolveModelRef("no-slash")).toThrow(/域\/modelId/);
  });

  it("getPrimaryFromEnv 读环境变量", () => {
    process.env.MODEL_MAIN_PRIMARY = "imageApi/seedream-image-v5.0-pro";
    expect(getPrimaryFromEnv("main")).toBe("imageApi/seedream-image-v5.0-pro");
  });
});
