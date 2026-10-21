import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/model-manager", () => ({
  getModel: vi.fn(() => "mock-main-model"),
  getModelRef: vi.fn(() => ({ id: "main/glm-5.3", gateway: "main", modelId: "glm-5.3" })),
}));

vi.mock("ai", () => ({
  streamText: vi.fn(),
}));

import { streamText } from "ai";

import { buildRevisePrompt } from "@/pipeline/prompts/writer";
import { writeScriptStream, type ScriptStreamEvent } from "@/pipeline/writer";
import type { ComicScript } from "@/pipeline/schema";

const valid = {
  title: "今天的KPI",
  source: "self-made" as const,
  source_url: "",
  theme: "职场",
  target_panels: 4,
  panels: [
    { scene: "办公室发呆", character: "打工仔", dialogue: "老板说要突破" },
    { scene: "深夜加班", character: "打工仔", dialogue: "我真的突破了" },
    { scene: "医生举病历", character: "医生", dialogue: "突破性进展" },
    { scene: "病床竖拇指", character: "打工仔", dialogue: "KPI完成！" },
  ],
  punchline: "KPI完成！",
  risk_tags: [],
};

const MD = `标题：今天的KPI
主题：职场
爆点：KPI完成！
风险：无

第1格
画面：办公室发呆
角色：打工仔
台词：老板说要突破

第2格
画面：深夜加班
角色：打工仔
台词：我真的突破了

第3格
画面：医生举病历
角色：医生
台词：突破性进展

第4格
画面：病床竖拇指
角色：打工仔
台词：KPI完成！
`;

const mockStreamText = streamText as unknown as ReturnType<typeof vi.fn>;

function streamOfParts(parts: unknown[]) {
  async function* fullStream() {
    for (const p of parts) yield p;
  }
  return { fullStream: fullStream() };
}

async function collect(gen: AsyncGenerator<ScriptStreamEvent>): Promise<ScriptStreamEvent[]> {
  const out: ScriptStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

beforeEach(() => {
  mockStreamText.mockReset();
});

describe("writeScriptStream", () => {
  it("依次产出 model / stage / thinking / text / done，done 带 clamp 后剧本", async () => {
    const half = Math.floor(MD.length / 2);
    mockStreamText.mockReturnValueOnce(
      streamOfParts([
        { type: "reasoning-delta", text: "先想节奏，再想爆点。" },
        { type: "text-delta", text: MD.slice(0, half) },
        { type: "reasoning-delta", text: "补充台词细节。" },
        { type: "text-delta", text: MD.slice(half) },
        { type: "finish", finishReason: "stop" },
      ]),
    );
    const events = await collect(
      writeScriptStream({ outline: "测试大纲", sourceType: "self-made" }),
    );
    expect(events[0]).toEqual({ type: "model", model: "main/glm-5.3" });
    expect(events[1]?.type).toBe("prompt");
    expect(events[2]?.type).toBe("stage");
    const thoughts = events
      .filter((e) => e.type === "thinking")
      .map((e) => (e as { content: string }).content);
    expect(thoughts).toEqual(["先想节奏，再想爆点。", "补充台词细节。"]);
    const texts = events
      .filter((e) => e.type === "text")
      .map((e) => (e as { content: string }).content);
    expect(texts.join("")).toBe(MD);
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    const script = (done as { script: ComicScript }).script;
    expect(script.panels).toHaveLength(4);
    expect(script.source).toBe("self-made");
  });

  it("输出无法解析时自动重试，第二次成功", async () => {
    mockStreamText.mockReturnValueOnce(
      streamOfParts([{ type: "text-delta", text: "这段输出不含模板。" }]),
    );
    mockStreamText.mockReturnValueOnce(
      streamOfParts([
        { type: "text-delta", text: MD },
        { type: "finish", finishReason: "stop" },
      ]),
    );
    const events = await collect(
      writeScriptStream({ outline: "测试大纲", sourceType: "user-outline" }),
    );
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    expect((done as { script: { source: string } }).script.source).toBe("user-outline");
    const stages = events.filter((e) => e.type === "stage");
    expect(stages.some((e) => e.type === "stage" && e.message.includes("重试"))).toBe(true);
    expect(mockStreamText).toHaveBeenCalledTimes(2);
  });

  it("全部失败时产出 error 事件", async () => {
    mockStreamText.mockImplementation(() =>
      streamOfParts([{ type: "error", error: { message: "网关 502" } }]),
    );
    const events = await collect(
      writeScriptStream({ outline: "测试大纲", sourceType: "self-made" }),
    );
    const last = events[events.length - 1];
    expect(last?.type).toBe("error");
    expect((last as { message: string }).message).toContain("502");
    expect(events.find((e) => e.type === "done")).toBeUndefined();
    expect(mockStreamText).toHaveBeenCalledTimes(3);
  });
});

describe("buildRevisePrompt", () => {
  it("包含大纲、当前剧本与修改意见", () => {
    const { system, prompt } = buildRevisePrompt("测试大纲", valid as never, "把爆点换成老板");
    expect(system).toContain("修改后的完整剧本");
    expect(prompt).toContain("测试大纲");
    expect(prompt).toContain(JSON.stringify(valid));
    expect(prompt).toContain("把爆点换成老板");
  });
});
