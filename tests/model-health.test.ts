import { afterEach, describe, expect, it, vi } from "vitest";
import { listModels, testModelConnection } from "@/model-manager";

afterEach(() => {
  vi.restoreAllMocks();
});

const okModels = () =>
  new Response(JSON.stringify({ data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("testModelConnection", () => {
  it("apiType=chat：先 /models，再 /chat/completions，stage=chat", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okModels())
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    const r = await testModelConnection(
      {
        biz: "main",
        modelId: "deepseek-chat",
        baseUrl: "https://gw/v1",
        apiKey: "sk-x",
        apiType: "chat",
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(r.ok).toBe(true);
    expect(r.stage).toBe("chat");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const chatBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(chatBody.max_tokens).toBeLessThanOrEqual(8);
  });

  it("apiType=responses：先 /models，再 /responses，stage=responses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okModels())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "completed", output_text: "hi" }), { status: 200 }),
      );
    const r = await testModelConnection(
      {
        biz: "main",
        modelId: "gpt-4o",
        baseUrl: "https://gw/v1",
        apiKey: "sk-x",
        apiType: "responses",
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(r.ok).toBe(true);
    expect(r.stage).toBe("responses");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const responsesBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(responsesBody.max_output_tokens).toBeLessThanOrEqual(8);
  });

  it("HTTP 401 → ok=false 且带 error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const r = await testModelConnection(
      {
        biz: "main",
        modelId: "deepseek-chat",
        baseUrl: "https://gw/v1",
        apiKey: "bad",
        apiType: "chat",
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("Key 留空且 Base URL 与已存端点不符 → 占位 key 探测并在 401 说明", async () => {
    process.env.MODEL_MAIN_BASE_URL = "https://saved.test/v1";
    process.env.MODEL_MAIN_API_KEY = "sk-saved";
    try {
      const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
      const r = await testModelConnection(
        { biz: "main", modelId: "deepseek-chat", baseUrl: "https://other.test/v1" },
        fetchImpl as unknown as typeof fetch,
      );
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/占位 key/);
      const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer env");
    } finally {
      delete process.env.MODEL_MAIN_BASE_URL;
      delete process.env.MODEL_MAIN_API_KEY;
    }
  });

  it("imageApi 域：只探 /models，不发 chat/responses，stage=http", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okModels());
    const r = await testModelConnection(
      {
        biz: "imageApi",
        modelId: "gpt-image-2.5",
        baseUrl: "https://img/v1",
        apiKey: "sk-img",
        apiType: "chat",
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(r.ok).toBe(true);
    expect(r.stage).toBe("http");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("listModels", () => {
  it("返回网关 /models 的 id 列表", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okModels());
    const models = await listModels(
      { baseUrl: "https://gw/v1", apiKey: "sk-x" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(models).toEqual(["deepseek-chat", "deepseek-reasoner"]);
  });

  it("Key 留空且同 Base URL → 复用该域库内 key（不把已存密钥发给陌生端点）", async () => {
    process.env.MODEL_MAIN_BASE_URL = "https://gw.test/v1";
    process.env.MODEL_MAIN_API_KEY = "sk-saved";
    try {
      const fetchImpl = vi.fn().mockResolvedValue(okModels());
      const models = await listModels(
        { baseUrl: "https://gw.test/v1/", biz: "main" },
        fetchImpl as unknown as typeof fetch,
      );
      expect(models).toEqual(["deepseek-chat", "deepseek-reasoner"]);
      const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer sk-saved");
    } finally {
      delete process.env.MODEL_MAIN_BASE_URL;
      delete process.env.MODEL_MAIN_API_KEY;
    }
  });
});
