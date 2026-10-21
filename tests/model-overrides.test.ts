import { afterEach, afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTempDb } from "./helpers/test-db";

// 运行时值必须动态 import：静态 import 会传递性 import @/lib/db，
// 在 setupTempDb() 改 DB_FILE 前就绑定真实 data/comics.db，测试写入将污染真实库。
let ss: typeof import("@/lib/settings-store");
let mm: typeof import("@/model-manager");

const tempDb = setupTempDb();

beforeAll(async () => {
  // 必须在 setupTempDb 设置好 DB_FILE 之后再导入 db 单例，确保指向临时库
  await import("@/lib/db");
  ss = await import("@/lib/settings-store");
  mm = await import("@/model-manager");
});

afterAll(async () => {
  await tempDb.cleanup();
});

afterEach(() => {
  ss.clearSettingsCache();
  for (const k of ["MODEL_MAIN_PRIMARY", "MODEL_MAIN_BASE_URL", "MODEL_MAIN_API_KEY"]) {
    delete process.env[k];
  }
});

describe("model-manager DB 覆盖", () => {
  it("DB 无覆盖时主模型取 env PRIMARY", async () => {
    process.env.MODEL_MAIN_PRIMARY = "main/glm-5.3";
    expect(mm.getModelChain("main")).toEqual(["main/glm-5.3"]);
  });

  it("env 与 DB 全空 → 报错提示变量名与配置入口", async () => {
    await ss.setModelSettings({ "MODEL.main.primary": "" });
    ss.clearSettingsCache();
    expect(() => mm.getModelChain("main")).toThrow(/业务域 main 未配置主模型/);
  });

  it("DB primary 顶替 env primary（替换语义，非并列）", async () => {
    const envPrimary = "main/claude-3-7-sonnet";
    process.env.MODEL_MAIN_PRIMARY = envPrimary;

    // ① 无 DB 覆盖时，env PRIMARY 就是整条链
    let chain = mm.getModelChain("main");
    expect(chain).toEqual([envPrimary]);

    // ② 写入 DB primary 后重读：DB 值顶替 env 值
    await ss.setModelSettings({ "MODEL.main.primary": "mainLight/gpt-4o" });
    chain = mm.getModelChain("main");
    // 替换语义（DB 覆盖 env），非保留：env-only 的 primary 必须从链中彻底消失
    expect(chain).toEqual(["mainLight/gpt-4o"]);
  });

  it("DB 裸 modelId 主模型绑定域级 env 网关（baseUrl 来自 DB）", async () => {
    await ss.setModelSettings({
      "MODEL.main.baseUrl": "https://db-gateway/v1",
      "MODEL.main.apiKey": "sk-db",
      "MODEL.main.primary": "deepseek-chat",
    });
    expect(mm.getPrimaryRef("main").id).toBe("main/deepseek-chat");
    expect(mm.getModelChain("main")).toEqual(["main/deepseek-chat"]);
  });

  it("仅 env 配置（DB 无覆盖）时，裸 modelId 同样可解析", async () => {
    // apiKey 传空串=保留旧值（不清覆盖），此处断言只关心 primary/baseUrl 回落 env
    await ss.setModelSettings({ "MODEL.main.primary": "", "MODEL.main.baseUrl": "" });
    ss.clearSettingsCache();
    process.env.MODEL_MAIN_BASE_URL = "https://env-gateway/v1";
    process.env.MODEL_MAIN_API_KEY = "sk-env";
    process.env.MODEL_MAIN_PRIMARY = "deepseek-chat";
    expect(mm.getModelChain("main")).toEqual(["main/deepseek-chat"]);
  });
});
