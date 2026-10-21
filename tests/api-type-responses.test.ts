import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setupTempDb } from "./helpers/test-db";
import { toResponsesRequest } from "@/model-manager/request/transform/to-responses";
import { fromResponsesOpenAICompat } from "@/model-manager/request/normalize/from-responses";
import type { TransformContext } from "@/model-manager/catalog/types";

// 运行时值必须动态 import：静态 import @/lib/settings-store 或 @/model-manager 会传递性 import @/lib/db，
// 在 setupTempDb() 改 DB_FILE 前就绑定真实 data/comics.db，测试写入将污染真实库。
// toResponsesRequest / fromResponsesOpenAICompat 为纯函数（仅 type-only import），可静态导入。
let ss: typeof import("@/lib/settings-store");
let mm: typeof import("@/model-manager");

const tempDb = setupTempDb();
beforeAll(async () => {
  await import("@/lib/db");
  ss = await import("@/lib/settings-store");
  mm = await import("@/model-manager");
});
afterAll(async () => {
  await tempDb.cleanup();
});
afterEach(() => {
  ss.clearSettingsCache();
  for (const k of [
    "MODEL_MAIN_LIGHT_API_TYPE",
    "MODEL_MAIN_LIGHT_BASE_URL",
    "MODEL_MAIN_LIGHT_API_KEY",
    "MODEL_MAIN_LIGHT_PRIMARY",
  ]) {
    delete process.env[k];
  }
  vi.restoreAllMocks();
});

describe("apiType / responses", () => {
  it("getApiTypeForBiz：缺省 chat，仅识别 responses（大小写不敏感）", () => {
    ss.clearSettingsCache();
    delete process.env.MODEL_MAIN_LIGHT_API_TYPE;
    expect(mm.getApiTypeForBiz("mainLight")).toBe("chat");
    process.env.MODEL_MAIN_LIGHT_API_TYPE = "RESPONSES";
    expect(mm.getApiTypeForBiz("mainLight")).toBe("responses");
    process.env.MODEL_MAIN_LIGHT_API_TYPE = "foo";
    expect(mm.getApiTypeForBiz("mainLight")).toBe("chat");
  });

  it("toResponsesRequest：system 进 instructions，其余进 input，max_tokens→max_output_tokens", () => {
    const { body } = toResponsesRequest(
      {
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "hi" },
        ],
        modelRef: "mainLight/m",
        temperature: 0.2,
        maxTokens: 128,
        responseFormat: { type: "json_object" },
      },
      { id: "mainLight/m", gateway: "mainLight", modelId: "m" },
    );
    expect(body.model).toBe("m");
    expect(body.instructions).toBe("sys");
    expect(body.input).toEqual([{ role: "user", content: "hi" }]);
    expect(body.max_output_tokens).toBe(128);
    expect(body.text).toEqual({ format: { type: "json_object" } });
  });

  it("fromResponsesOpenAICompat：优先 output_text，status→finishReason", () => {
    const ctx = {
      ref: { id: "mainLight/m", gateway: "mainLight", modelId: "m" },
      profile: { id: "standard", capabilities: {} },
      stream: false,
    } as unknown as TransformContext;
    const res = fromResponsesOpenAICompat(
      {
        id: "resp_1",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "ignored" }],
          },
        ],
        output_text: "final",
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      },
      ctx,
    );
    expect(res.content).toBe("final");
    expect(res.finishReason).toBe("stop");
    expect(res.usage?.totalTokens).toBe(3);
  });

  it("chatCompletionForBiz：apiType=responses 走 /responses 并解析 output_text", async () => {
    ss.clearSettingsCache();
    await ss.setModelSettings({
      "MODEL.mainLight.baseUrl": "https://gw/v1",
      "MODEL.mainLight.apiKey": "sk-x",
      "MODEL.mainLight.apiType": "responses",
      "MODEL.mainLight.primary": "resp-model",
    });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_1",
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "hi there" }],
            },
          ],
          output_text: "hi there",
          usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const out = await mm.chatCompletionForBiz("mainLight", [{ role: "user", content: "hi" }], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toBe("hi there");
    const url = String(
      fetchImpl.mock.calls.find((c) => String(c?.[0]).includes("/responses"))?.[0] ?? "",
    );
    expect(url).toContain("/responses");
    const call = fetchImpl.mock.calls.find((c) => String(c?.[0]).includes("/responses"))!;
    const body = JSON.parse(String(call[1]?.body));
    expect(body.model).toBe("resp-model");
    expect(Array.isArray(body.input)).toBe(true);
  });
});
