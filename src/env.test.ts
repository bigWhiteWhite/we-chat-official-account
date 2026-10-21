import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("env 校验", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(process.env)) {
      saved[k] = process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  it("APPID 缺失时不抛错（放宽为可选，设置页可后配）", async () => {
    delete process.env.APPID;
    delete process.env.APPSECRET;
    delete process.env.AUTHOR;
    delete process.env.SKIP_ENV_VALIDATION;
    const { serverEnv } = await import("./env");
    expect(serverEnv.APPID).toBeUndefined();
    expect(serverEnv.APPSECRET).toBeUndefined();
    expect(serverEnv.AUTHOR).toBeUndefined();
  });

  it("APPID 为占位符时抛错", async () => {
    process.env.APPID = "your-appid";
    process.env.APPSECRET = "secret";
    process.env.AUTHOR = "作者";
    delete process.env.SKIP_ENV_VALIDATION;
    await expect(import("./env")).rejects.toThrow(/APPID/);
  });

  it("合法配置解析出带默认值的完整 env", async () => {
    process.env.APPID = "wx1234567890";
    process.env.APPSECRET = "secret";
    process.env.AUTHOR = "作者";
    delete process.env.SKIP_ENV_VALIDATION;
    delete process.env.PANELS_MAX_PER_CHAPTER;
    vi.resetModules();
    const { serverEnv } = await import("./env");
    expect(serverEnv.APPID).toBe("wx1234567890");
    expect(serverEnv.PANELS_MAX_PER_CHAPTER).toBe(40);
  });
});
