import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ComicScript } from "@/pipeline/schema";

const mockWithModelFallback = vi.hoisted(() =>
  vi.fn(
    async (
      _biz: string,
      fn: (ctx: { ref: { id: string; gateway: string; modelId: string } }) => Promise<unknown>,
    ) =>
      fn({ ref: { id: "imageApi/gpt-image-2.5", gateway: "imageApi", modelId: "gpt-image-2.5" } }),
  ),
);
const mockGetGatewayHttpConfig = vi.hoisted(() =>
  vi.fn(() => ({
    gateway: "imageApi",
    baseUrl: "https://img.example/v1",
    apiKey: "test-key",
    apiType: "chat",
    imageProtocol: "openai",
  })),
);

vi.mock("@/model-manager", () => ({
  withModelFallback: mockWithModelFallback,
  getGatewayHttpConfig: mockGetGatewayHttpConfig,
}));

import {
  buildSubjectPrompts,
  callImageEdits,
  drawPanels,
  parseSubjectPromptOverrides,
} from "@/pipeline/artist";
import { buildPanelPrompt } from "@/pipeline/prompts/panel";
import {
  buildCharacterViewPrompt,
  buildSceneViewPrompt,
  buildStylePreviewPrompt,
} from "@/pipeline/prompts/subjects";

const script = {
  title: "今天的KPI",
  source: "self-made",
  source_url: "",
  theme: "职场",
  target_panels: 2,
  panels: [
    { scene: "办公室发呆", character: "打工仔", dialogue: "老板说今天要突破自己" },
    { scene: "深夜加班", character: "打工仔", dialogue: "我真的突破了" },
  ],
  punchline: "KPI完成！",
  risk_tags: [],
} as unknown as ComicScript;

function fakeImageResponse(b64: string) {
  return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200 });
}

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("buildPanelPrompt", () => {
  it("包含画风、格序、画面/角色/台词与一致性约束", () => {
    const p = buildPanelPrompt(script, script.panels[0], 0, "简约线条");
    expect(p).toContain("简约线条");
    expect(p).toContain("第 1 格");
    expect(p).toContain("办公室发呆");
    expect(p).toContain("打工仔");
    expect(p).toContain("老板说今天要突破自己");
    expect(p).toContain("与参考图保持一致");
  });

  it("默认不将旁白渲染进画面（横竖版一致）", () => {
    const withNarration = {
      ...script,
      panels: [
        { scene: "办公室发呆", character: "打工仔", dialogue: "你好", narration: "深夜的城市" },
      ],
    } as unknown as ComicScript;
    const tall = buildPanelPrompt(withNarration, withNarration.panels[0], 0, "preset", "tall");
    const wide = buildPanelPrompt(withNarration, withNarration.panels[0], 0, "preset", "wide");
    expect(tall).not.toContain("旁白文字");
    expect(wide).not.toContain("深夜的城市");
  });

  it("narrationInImage 开启时横竖版均渲染旁白，「无」视为无旁白", () => {
    const withNarration = {
      ...script,
      panels: [
        { scene: "办公室发呆", character: "打工仔", dialogue: "你好", narration: "深夜的城市" },
        { scene: "深夜加班", character: "打工仔", dialogue: "好的", narration: "无" },
      ],
    } as unknown as ComicScript;
    const tall = buildPanelPrompt(
      withNarration,
      withNarration.panels[0],
      0,
      "preset",
      "tall",
      true,
    );
    expect(tall).toContain("旁白文字「深夜的城市」");
    const wide = buildPanelPrompt(
      withNarration,
      withNarration.panels[0],
      0,
      "preset",
      "wide",
      true,
    );
    expect(wide).toContain("旁白文字「深夜的城市」");
    const nonePanel = buildPanelPrompt(
      withNarration,
      withNarration.panels[1],
      1,
      "preset",
      "tall",
      true,
    );
    expect(nonePanel).not.toContain("旁白文字");
  });
});

describe("主体参考图提示词组装", () => {
  it("三个 build*Prompt 与实际生成提示词一致", () => {
    expect(buildStylePreviewPrompt("Q版")).toContain("画风：Q版");
    expect(buildSceneViewPrompt("办公室", "Q版")).toContain("场景描述：办公室");
    const p = buildCharacterViewPrompt("打工仔", "灰色卫衣", "Q版");
    expect(p).toContain("角色三视图");
    expect(p).toContain("不要拟人化成人形或直立行走");
    expect(p).toContain("画风：Q版");
    expect(p).toContain("角色名：打工仔。外观设定：灰色卫衣");
  });

  it("buildSubjectPrompts：绑定资产的主体为 null，未绑定可组装；无 refs 时从剧本构建", async () => {
    const refs = {
      style: { assetId: null, preset: "Q版", image: null },
      scene: { assetId: "s1", name: "办公室", image: null },
      characters: [
        { name: "打工仔", assetId: null, image: null },
        { name: "老板", assetId: "c1", image: null },
      ],
    };
    const withRefs = await buildSubjectPrompts({
      script: null,
      refs,
      stylePreset: "Q版",
      characterPreset: "Q版",
    });
    expect(withRefs.style).toContain("画风：Q版");
    expect(withRefs.scene).toBeNull();
    expect(withRefs.characters[0]).toContain("角色名：打工仔");
    expect(withRefs.characters[1]).toBeNull();

    const fromScript = await buildSubjectPrompts({
      script,
      refs: null,
      stylePreset: "Q版",
      characterPreset: "Q版",
    });
    expect(fromScript.style).toContain("画风：Q版");
    expect(fromScript.scene).toBeNull();
    expect(fromScript.characters[0]).toContain("角色名：打工仔");
  });

  it("buildSubjectPrompts：主体提示词覆盖优先于默认组装", async () => {
    const refs = {
      style: { assetId: null, preset: "Q版", image: null },
      scene: { assetId: null, name: "办公室", image: null },
      characters: [{ name: "打工仔", assetId: null, image: null }],
    };
    const prompts = await buildSubjectPrompts({
      script: null,
      refs,
      stylePreset: "Q版",
      characterPreset: "Q版",
      promptOverrides: {
        style: "自定义画风提示词",
        scene: "自定义场景提示词",
        characters: { 打工仔: "自定义角色提示词" },
      },
    });
    expect(prompts.style).toBe("自定义画风提示词");
    // 主场景不再文生图：scene 提示词恒为 null（即使存在历史覆盖值）
    expect(prompts.scene).toBeNull();
    expect(prompts.characters[0]).toBe("自定义角色提示词");
  });

  it("parseSubjectPromptOverrides：忽略损坏 JSON、非字符串与空字符串", () => {
    expect(parseSubjectPromptOverrides("{bad")).toEqual({});
    expect(parseSubjectPromptOverrides(null)).toEqual({});
    expect(
      parseSubjectPromptOverrides(
        JSON.stringify({ style: "  ", scene: "办公室", characters: { "": "", 老板: "老板" } }),
      ),
    ).toEqual({ scene: "办公室", characters: { 老板: "老板" } });
  });
});

describe("callImageEdits", () => {
  it("走 /images/edits multipart 请求并写入结果文件", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "artist-"));
    try {
      const refPath = path.join(dir, "ref.png");
      writeFileSync(refPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const outPath = path.join(dir, "out.png");
      const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
        expect(String(input)).toContain("/images/edits");
        const body = init?.body as FormData;
        expect(body.get("model")).toBe("gpt-image-2.5");
        expect(body.get("response_format")).toBe("b64_json");
        expect(body.getAll("image")).toHaveLength(1);
        return fakeImageResponse(Buffer.from("img-bytes").toString("base64"));
      });
      vi.stubGlobal("fetch", fetchMock);
      const img = await callImageEdits("prompt", [refPath], outPath);
      expect(img.path).toBe(outPath);
      expect(readFileSync(outPath)).toEqual(Buffer.from("img-bytes"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("imageProtocol=si-image：走 /wand/si-image/generation", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "artist-"));
    try {
      const refPath = path.join(dir, "ref.png");
      writeFileSync(refPath, Buffer.from("REF"));
      const outPath = path.join(dir, "out.png");
      const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/wand/si-image/generation")) {
          const body = JSON.parse(String(init?.body)) as {
            model: string;
            images?: string[];
            size?: string;
          };
          expect(body.model).toBe("gpt-image-2.5");
          expect(body.size).toBe("1920x1088");
          expect(body.images).toEqual([
            `data:image/png;base64,${Buffer.from("REF").toString("base64")}`,
          ]);
          return new Response(
            JSON.stringify({ data: [{ url: "https://cdn.example/i.png", size: "1920x1088" }] }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        expect(url).toBe("https://cdn.example/i.png");
        return new Response(Buffer.from("si-bytes"));
      });
      vi.stubGlobal("fetch", fetchMock);
      mockGetGatewayHttpConfig.mockReturnValueOnce({
        gateway: "imageApi",
        baseUrl: "https://img.example/v1",
        apiKey: "test-key",
        apiType: "chat",
        imageProtocol: "si-image",
      });
      const img = await callImageEdits("prompt", [refPath], outPath, undefined, "1920x1088");
      expect(img).toEqual({ path: outPath, width: 1920, height: 1088 });
      expect(readFileSync(outPath)).toEqual(Buffer.from("si-bytes"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("drawPanels", () => {
  it("单格失败不影响其余格，返回对齐数组与 onPanel 事件", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "artist-"));
    try {
      const refPath = path.join(dir, "ref.png");
      writeFileSync(refPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
        const body = init?.body as FormData;
        const prompt = String(body?.get("prompt") ?? "");
        if (prompt.includes("第 1 格")) {
          return new Response("boom", { status: 500 });
        }
        return fakeImageResponse(Buffer.from("ok").toString("base64"));
      });
      vi.stubGlobal("fetch", fetchMock);
      const events: Array<{ index: number; path?: string; error?: string }> = [];
      const results = await drawPanels(script, dir, [refPath], (index, r) => {
        events.push({ index, ...r });
      });
      expect(results[0]).toBeNull();
      expect(results[1] ?? "").toMatch(/panel-02\.v\d+\.png/);
      expect(events.some((e) => e.index === 0 && !!e.error)).toBe(true);
      expect(events.some((e) => e.index === 1 && !!e.path)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
