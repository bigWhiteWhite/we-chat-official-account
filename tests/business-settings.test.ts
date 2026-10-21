import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTempDb } from "./helpers/test-db";

// 运行时值必须动态 import：静态 import 会传递性 import @/lib/db，
// 在 setupTempDb() 改 DB_FILE 前就绑定真实 data/comics.db，测试写入将污染真实库。
let ss: typeof import("@/lib/settings-store");
let bs: typeof import("@/lib/business-settings");

const tempDb = setupTempDb();
beforeAll(async () => {
  await import("@/lib/db");
  ss = await import("@/lib/settings-store");
  bs = await import("@/lib/business-settings");
});
afterAll(async () => {
  await tempDb.cleanup();
});
// vitest.config 预置了 APPID/APPSECRET/AUTHOR，每个用例前清掉，保证「无值」断言成立
beforeEach(() => {
  for (const k of [
    "APPID",
    "APPSECRET",
    "AUTHOR",
    "STYLE_PRESET",
    "NARRATION_IN_IMAGE",
    "IMAGE_GEN_CONCURRENCY",
  ]) {
    delete process.env[k];
  }
});
afterEach(() => {
  ss.clearSettingsCache();
  for (const k of [
    "APPID",
    "APPSECRET",
    "AUTHOR",
    "STYLE_PRESET",
    "NARRATION_IN_IMAGE",
    "IMAGE_GEN_CONCURRENCY",
  ]) {
    delete process.env[k];
  }
});

describe("business-settings", () => {
  it("无值时回落默认", () => {
    expect(bs.getAppId()).toBe("");
    expect(bs.getAppSecret()).toBe("");
    expect(bs.getAuthor()).toBe("");
    expect(bs.getStylePreset()).toBe("简约线条+低饱和色块+扁平卡通");
    expect(bs.getNarrationInImage()).toBe(false);
    expect(bs.getImageGenConcurrency()).toBe(2);
  });

  it("env 回落，DB 覆盖优先", async () => {
    process.env.APPID = "wx-env";
    process.env.IMAGE_GEN_CONCURRENCY = "5";
    expect(bs.getAppId()).toBe("wx-env");
    expect(bs.getImageGenConcurrency()).toBe(5);
    await ss.setModelSettings({ "BUSINESS.appid": "wx-db", "BUSINESS.narrationInImage": "true" });
    expect(bs.getAppId()).toBe("wx-db");
    expect(bs.getNarrationInImage()).toBe(true);
  });

  it("IMAGE_GEN_CONCURRENCY 非法值回落 2", () => {
    process.env.IMAGE_GEN_CONCURRENCY = "abc";
    expect(bs.getImageGenConcurrency()).toBe(2);
  });
});
