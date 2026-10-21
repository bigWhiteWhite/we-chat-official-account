import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTempDb } from "./helpers/test-db";

// 运行时值必须动态 import：静态 import @/lib/settings-store 会传递性 import @/lib/db，
// 在 setupTempDb() 改 DB_FILE 之前就按首个 DB_FILE 绑定真实 data/comics.db，测试写入将污染真实库。
// 故在 beforeAll 里先 import db（绑定临时库）再动态加载 settings-store。
let ss: typeof import("@/lib/settings-store");

const tempDb = setupTempDb();

beforeAll(async () => {
  await import("@/lib/db");
  ss = await import("@/lib/settings-store");
});

afterAll(async () => {
  await tempDb.cleanup();
});

describe("settings-store", () => {
  it("maskValue 掩码", () => {
    expect(ss.maskValue(undefined)).toBeUndefined();
    expect(ss.maskValue("ab")).toBe("****");
    expect(ss.maskValue("sk-1234567890")).toBe("****7890");
  });

  it("DB 空时 envOrSetting 回落 process.env", () => {
    ss.clearSettingsCache();
    process.env.MODEL_MAIN_PRIMARY = "main/glm-5.3";
    expect(ss.envOrSetting("MODEL_MAIN_PRIMARY")).toBe("main/glm-5.3");
    expect(ss.envOrSetting("MODEL_VISION_PRIMARY")).toBeUndefined();
  });

  it("setModelSettings 覆盖 env，删除后回落 env", async () => {
    ss.clearSettingsCache();
    process.env.MODEL_MAIN_BASE_URL = "https://env-fallback/v1";
    await ss.setModelSettings({ "MODEL.main.baseUrl": "https://db-override/v1" });
    expect(ss.getSetting("MODEL.main.baseUrl")).toBe("https://db-override/v1");
    expect(ss.envOrSetting("MODEL_MAIN_BASE_URL")).toBe("https://db-override/v1");
    await ss.setModelSettings({ "MODEL.main.baseUrl": undefined });
    expect(ss.getSetting("MODEL.main.baseUrl")).toBeUndefined();
    expect(ss.envOrSetting("MODEL_MAIN_BASE_URL")).toBe("https://env-fallback/v1");
  });

  it("apiKey 键空串 = 不修改（保留旧值）", async () => {
    ss.clearSettingsCache();
    await ss.setModelSettings({ "MODEL.main.apiKey": "sk-real" });
    await ss.setModelSettings({ "MODEL.main.apiKey": "" });
    expect(ss.getSetting("MODEL.main.apiKey")).toBe("sk-real");
  });

  it("apiType 非空写入；空串清除覆盖（回落 chat 默认）", async () => {
    ss.clearSettingsCache();
    delete process.env.MODEL_MAIN_API_TYPE;
    await ss.setModelSettings({ "MODEL.main.apiType": "responses" });
    expect(ss.envOrSetting("MODEL_MAIN_API_TYPE")).toBe("responses");
    await ss.setModelSettings({ "MODEL.main.apiType": "" });
    expect(ss.getSetting("MODEL.main.apiType")).toBeUndefined();
    expect(ss.envOrSetting("MODEL_MAIN_API_TYPE")).toBeUndefined();
  });

  it("写入跨缓存重建持久化", async () => {
    ss.clearSettingsCache();
    await ss.setModelSettings({ "MODEL.global.autoFallback": "false" });
    ss.clearSettingsCache();
    await ss.ensureSettingsLoaded();
    expect(ss.envOrSetting("MODEL_AUTO_FALLBACK")).toBe("false");
  });
});
