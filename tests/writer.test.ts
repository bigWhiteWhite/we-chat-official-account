import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/model-manager", () => ({
  getModel: vi.fn(() => "mock-main-model"),
  getModelRef: vi.fn(() => ({ id: "main/glm-5.3" })),
}));

vi.mock("ai", () => ({
  streamText: vi.fn(),
}));

import { streamText } from "ai";

import { writeScriptStream } from "@/pipeline/writer";
import { clampScript, ComicScriptSchema } from "@/pipeline/schema";

import type { ComicScript } from "@/pipeline/schema";

/** 消费完整写流，取 done 事件的剧本（与页面 generate-script 实际消费方式一致） */
async function runScript(input: Parameters<typeof writeScriptStream>[0]): Promise<ComicScript> {
  let script: ComicScript | null = null;
  for await (const ev of writeScriptStream(input)) {
    if (ev.type === "done") script = ev.script;
  }
  if (!script) throw new Error("剧本生成未返回结果");
  return script;
}

const valid = {
  title: "今天的KPI",
  source: "self-made" as const,
  theme: "职场",
  target_panels: 4,
  panels: [
    { scene: "办公室发呆", character: "打工仔", dialogue: "老板说今天要突破自己" },
    { scene: "深夜加班", character: "打工仔", dialogue: "我真的突破了" },
    { scene: "医生举病历", character: "医生", dialogue: "突破性进展：住院" },
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
台词：老板说今天要突破自己

第2格
画面：深夜加班
角色：打工仔
台词：我真的突破了

第3格
画面：医生举病历
角色：医生
台词：突破性进展：住院

第4格
画面：病床竖拇指
角色：打工仔
台词：KPI完成！
`;

const mockStreamText = streamText as unknown as ReturnType<typeof vi.fn>;

/** 模拟 streamText：把整段文本拆两片以 text-delta 流出 */
function streamOfText(text: string) {
  async function* fullStream() {
    const half = Math.floor(text.length / 2);
    if (half > 0) yield { type: "text-delta", textDelta: text.slice(0, half) };
    yield { type: "text-delta", textDelta: text.slice(half) };
    yield { type: "finish", finishReason: "stop" };
  }
  return { fullStream: fullStream() };
}

beforeEach(() => {
  mockStreamText.mockReset();
});

describe("ComicScriptSchema", () => {
  it("合法剧本通过", () => {
    const r = ComicScriptSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("对话超过 300 字拒绝", () => {
    const bad = {
      ...valid,
      panels: valid.panels.map((p, i) => (i === 0 ? { ...p, dialogue: "x".repeat(301) } : p)),
    };
    expect(ComicScriptSchema.safeParse(bad).success).toBe(false);
  });

  it("少于 4 格拒绝", () => {
    expect(
      ComicScriptSchema.safeParse({ ...valid, panels: valid.panels.slice(0, 3) }).success,
    ).toBe(false);
  });
});

describe("clampScript", () => {
  it("超长标题截断到 32 字", () => {
    const clamped = clampScript({ ...valid, title: "长".repeat(40) });
    expect(clamped.title.length).toBe(32);
  });
});

describe("writeScriptStream", () => {
  it("Markdown 输出解析后做 clamp 与 source/source_url 覆写", async () => {
    mockStreamText.mockReturnValueOnce(
      streamOfText(MD.replace("标题：今天的KPI", `标题：${"长".repeat(40)}`)),
    );
    const s = await runScript({ outline: "测试大纲", sourceType: "self-made" });
    expect(s.title.length).toBe(32);
    expect(s.source).toBe("self-made");
    expect(s.source_url).toBe("");
    expect(s.panels).toHaveLength(4);
    expect(s.panels[0].dialogue).toBe("老板说今天要突破自己");
  });

  it("输出无法解析时自动重试，第二次成功", async () => {
    mockStreamText.mockReturnValueOnce(streamOfText("抱歉，我无法直接输出模板。"));
    mockStreamText.mockReturnValueOnce(streamOfText(MD));
    const s = await runScript({ outline: "测试大纲", sourceType: "user-outline" });
    expect(s.title).toBe("今天的KPI");
    expect(s.source).toBe("user-outline");
    expect(mockStreamText).toHaveBeenCalledTimes(2);
  });

  it("传入合集上下文时，prompt 以系列段落开头并保留大纲", async () => {
    mockStreamText.mockReturnValueOnce(streamOfText(MD));
    const seriesSection = [
      "【连载合集：阿强和他的猫】",
      "常驻主角（每集固定出场，务必使用固定姓名，人设与外观须与参考图保持一致）：",
      "  - 阿强：保安（关键词：保安, 橘猫）",
      "前情回顾（避免重复已发生的桥段，保持故事连续性）：",
      "  - 第 1 集《救猫》：阿强深夜巡逻救下橘猫。",
    ].join("\n");
    await runScript({ outline: "测试大纲", sourceType: "self-made", seriesSection });
    const call = mockStreamText.mock.calls.at(-1)?.[0] as { prompt: string };
    expect(call.prompt.startsWith(seriesSection)).toBe(true);
    expect(call.prompt).toContain("大纲/素材：\n测试大纲");
  });
});
