import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupTempDb } from "./helpers/test-db";
// 仅 type-only import：构建时擦除，不会在运行时触发 @/lib/db 求值
import type { AppSettingsSavePayload } from "@/lib/settings-payload";

const tempDb = setupTempDb();

// 运行时值必须动态 import：settings-store / settings-payload 会传递性 import @/lib/db，
// 若用顶层静态 import，会在 setupTempDb() 设置 DB_FILE 之前就把 db 单例绑到真实库，
// 导致测试写读全部落到 data/comics.db。故在 beforeAll 里先 import db（绑定临时库）再加载业务模块。
let ss: typeof import("@/lib/settings-store");
let sp: typeof import("@/lib/settings-payload");

beforeAll(async () => {
  await import("@/lib/db");
  ss = await import("@/lib/settings-store");
  sp = await import("@/lib/settings-payload");
});
afterAll(async () => {
  await tempDb.cleanup();
});

afterEach(() => {
  ss?.clearSettingsCache();
  for (const k of [
    "MODEL_MAIN_PRIMARY",
    "MODEL_MAIN_API_TYPE",
    "MODEL_IMAGE_API_IMAGE_PROTOCOL",
    "MODEL_BASE_URL",
    "MODEL_API_KEY",
    "MODEL_MAIN_API_KEY",
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

const emptySave = (): AppSettingsSavePayload => ({
  domains: {
    main: { apiType: "chat", imageProtocol: "openai", primary: "", baseUrl: "", apiKey: "" },
    mainLight: { apiType: "chat", imageProtocol: "openai", primary: "", baseUrl: "", apiKey: "" },
    vision: { apiType: "chat", imageProtocol: "openai", primary: "", baseUrl: "", apiKey: "" },
    imageApi: {
      apiType: "chat",
      imageProtocol: "openai",
      primary: "",
      baseUrl: "",
      apiKey: "",
    },
  },
  global: { autoFallback: true, baseUrl: "", apiKey: "" },
  business: {
    appid: "",
    appsecret: "",
    author: "",
    stylePreset: "",
    narrationInImage: false,
    imageGenConcurrency: 2,
  },
});

describe("settings-payload", () => {
  it("build：DB 覆盖 + env 回落 + key 掩码", async () => {
    process.env.MODEL_MAIN_PRIMARY = "main/glm-5.3";
    process.env.MODEL_MAIN_API_TYPE = "responses";
    process.env.MODEL_BASE_URL = "https://env/v1";
    process.env.MODEL_API_KEY = "sk-1234567890";
    await ss.setModelSettings({ "MODEL.main.baseUrl": "https://db/v1" });
    const p = await sp.buildAppSettingsPayload();
    expect(p.domains.main.primary).toBe("main/glm-5.3");
    expect(p.domains.main.apiType).toBe("responses"); // env 读取
    expect(p.domains.main.baseUrl).toBe("https://db/v1"); // DB 优先
    expect(p.domains.main.hasApiKey).toBe(false);
    expect(p.global.baseUrl).toBe("https://env/v1");
    expect(p.global.apiKeyMasked).toBe("****7890");
    expect(p.global.hasApiKey).toBe(true);
  });

  it("save：apiType 写入 + apiType 空串清除覆盖（回落 chat 默认）", async () => {
    await ss.setModelSettings({ "MODEL.main.apiType": "responses" });
    let p = emptySave();
    p.domains.main.apiType = "responses";
    await sp.saveAppSettingsPayload(p);
    let after = await sp.buildAppSettingsPayload();
    expect(after.domains.main.apiType).toBe("responses");
    // 保存 chat（默认值）→ 清除 DB 覆盖，回落 env
    delete process.env.MODEL_MAIN_API_TYPE;
    p = emptySave();
    p.domains.main.apiType = "chat";
    await sp.saveAppSettingsPayload(p);
    after = await sp.buildAppSettingsPayload();
    expect(after.domains.main.apiType).toBe("chat");
  });

  it("save：imageProtocol 读 env 并可写回（仅 imageApi 域有实际消费者）", async () => {
    // 前序用例的整体保存会把默认值物化进 DB（DB 覆盖优先于 env），先清掉该行
    await ss.setModelSettings({ "MODEL.imageApi.imageProtocol": undefined });
    process.env.MODEL_IMAGE_API_IMAGE_PROTOCOL = "SI-Image";
    let after = await sp.buildAppSettingsPayload();
    expect(after.domains.imageApi.imageProtocol).toBe("si-image");
    expect(after.domains.main.imageProtocol).toBe("openai");

    delete process.env.MODEL_IMAGE_API_IMAGE_PROTOCOL;
    const p = emptySave();
    p.domains.imageApi.imageProtocol = "si-image";
    await sp.saveAppSettingsPayload(p);
    after = await sp.buildAppSettingsPayload();
    expect(after.domains.imageApi.imageProtocol).toBe("si-image"); // DB 覆盖生效
  });

  it("save：写入后可读回；apiKey 空串不覆盖旧值", async () => {
    await ss.setModelSettings({ "MODEL.main.apiKey": "sk-keep" });
    const p = emptySave();
    p.domains.main.primary = "deepseek-chat";
    p.domains.main.baseUrl = "https://api.deepseek.com/v1";
    p.domains.main.apiKey = ""; // 不修改
    await sp.saveAppSettingsPayload(p);
    const after = await sp.buildAppSettingsPayload();
    expect(after.domains.main.primary).toBe("deepseek-chat");
    expect(after.domains.main.apiKeyMasked).toBe("****keep");
    expect(after.domains.main.hasApiKey).toBe(true);
  });

  it("build：业务字段掩码 + 只读 dbFile/reserved", async () => {
    process.env.APPID = "wx123";
    process.env.APPSECRET = "wx-secret-9999";
    const p = await sp.buildAppSettingsPayload();
    expect(p.business.appid).toBe("wx123");
    expect(p.business.appsecretMasked).toBe("****9999");
    expect(p.business.hasAppsecret).toBe(true);
    expect(p.business.author).toBe("");
    expect(p.business.stylePreset).toBe("简约线条+低饱和色块+扁平卡通");
    expect(p.business.narrationInImage).toBe(false);
    expect(p.business.imageGenConcurrency).toBe(2);
    expect(p.business.dbFile).toBe(process.env.DB_FILE ?? "./data/comics.db");
    expect(p.business.reserved).toHaveProperty("comicsDir");
  });

  it("save：业务字段读回；appsecret 空串不覆盖", async () => {
    await ss.setModelSettings({ "BUSINESS.appsecret": "sk-keep" });
    const p = emptySave();
    p.business.appid = "wx456";
    p.business.author = "作者甲";
    p.business.narrationInImage = true;
    p.business.imageGenConcurrency = 4;
    p.business.appsecret = ""; // 不修改
    await sp.saveAppSettingsPayload(p);
    const after = await sp.buildAppSettingsPayload();
    expect(after.business.appid).toBe("wx456");
    expect(after.business.author).toBe("作者甲");
    expect(after.business.narrationInImage).toBe(true);
    expect(after.business.imageGenConcurrency).toBe(4);
    expect(after.business.appsecretMasked).toBe("****keep");
    expect(after.business.hasAppsecret).toBe(true);
  });
});
