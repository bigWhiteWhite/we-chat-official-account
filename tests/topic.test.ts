import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/model-manager", () => ({
  chatCompletionForBiz: vi.fn(),
}));

import { chatCompletionForBiz } from "@/model-manager";

import { setupTempDb, type TempDb } from "./helpers/test-db";

let tdb: TempDb;

beforeAll(() => {
  tdb = setupTempDb();
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
}, 30_000);

const mockChat = chatCompletionForBiz as unknown as ReturnType<typeof vi.fn>;

describe("hashTopic", () => {
  it("同文本同 hash，忽略首尾空格与大小写", async () => {
    const { hashTopic } = await import("@/pipeline/topic");
    expect(hashTopic("职场梗")).toBe(hashTopic("职场梗"));
    expect(hashTopic(" 职场梗 ")).toBe(hashTopic("职场梗"));
    expect(hashTopic("Office Meme")).toBe(hashTopic("office meme"));
    expect(hashTopic("职场梗")).not.toBe(hashTopic("爱情梗"));
  });
});

describe("parseTolerantJson", () => {
  it("解析 ```json 围栏输出", async () => {
    const { parseTolerantJson } = await import("@/pipeline/topic");
    expect(parseTolerantJson<{ topics: string[] }>('```json\n{"topics": ["a"]}\n```')).toEqual({
      topics: ["a"],
    });
  });

  it("容忍前后杂散文本", async () => {
    const { parseTolerantJson } = await import("@/pipeline/topic");
    expect(
      parseTolerantJson<{ topics: string[] }>('以下是结果：\n{"topics": ["b"]}\n完毕。'),
    ).toEqual({ topics: ["b"] });
  });

  it("不可解析时抛错（由 pRetry 重试）", async () => {
    const { parseTolerantJson } = await import("@/pipeline/topic");
    expect(() => parseTolerantJson("完全不是 JSON")).toThrow();
  });
});
describe("pickTopics 去重", () => {
  it("30 天内重复候选被过滤，新候选落库", async () => {
    const { db } = await import("@/lib/db");
    const { hashTopic, pickTopics } = await import("@/pipeline/topic");
    await db.topic.create({
      data: { text: "旧梗", source: "self-made", hash: hashTopic("旧梗"), usedAt: new Date() },
    });
    mockChat.mockResolvedValueOnce(JSON.stringify({ topics: ["旧梗", "新梗", "更新的梗"] }));
    const picked = await pickTopics(2, []);
    expect(picked.map((t) => t.text)).toEqual(["新梗", "更新的梗"]);
    const saved = await db.topic.findMany({ where: { text: "新梗" } });
    expect(saved).toHaveLength(1);
    await db.$disconnect();
  });

  it("候选全部重复时返回空数组且不重复落库", async () => {
    const { db } = await import("@/lib/db");
    const { pickTopics } = await import("@/pipeline/topic");
    mockChat.mockResolvedValueOnce(JSON.stringify({ topics: ["旧梗", "新梗"] }));
    const picked = await pickTopics(2, []);
    expect(picked).toEqual([]);
    await db.$disconnect();
  });

  it("标签说明注入选题 prompt", async () => {
    const { db } = await import("@/lib/db");
    const { pickTopics } = await import("@/pipeline/topic");
    mockChat.mockResolvedValueOnce(JSON.stringify({ topics: ["标签梗"] }));
    await pickTopics(1, [{ name: "古风古代", description: "架空古代背景，禁止说书人" }]);
    const prompt = mockChat.mock.calls.at(-1)?.[1]?.[0]?.content ?? "";
    expect(prompt).toContain("古风古代");
    expect(prompt).toContain("架空古代背景，禁止说书人");
    await db.$disconnect();
  });
});
