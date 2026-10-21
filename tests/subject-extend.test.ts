import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGenerateObject = vi.hoisted(() =>
  vi.fn(async (_opts: { prompt?: string }) => ({
    object: {
      name: "小龙女",
      appearance: "白发红衣，清冷气质",
      keywords: "小龙女, 古墓, 白衣",
      characterProfile: "守古墓的仙子，身世神秘",
      personality: "外冷内热",
      traits: "发间常别一支白玉簪",
    },
  })),
);
vi.mock("ai", () => ({ generateObject: mockGenerateObject }));

const mockGetModel = vi.hoisted(() => vi.fn(() => ({ id: "test-model" })));
vi.mock("@/model-manager", () => ({ getModel: mockGetModel, withModelFallback: vi.fn() }));

const mockCallImageEdits = vi.hoisted(() =>
  vi.fn(async (_p: string, _refs: string[], outPath: string) => ({
    path: outPath,
    width: 1024,
    height: 1024,
  })),
);
vi.mock("@/pipeline/artist", () => ({ callImageEdits: mockCallImageEdits }));

const mockReplaceAssetLinks = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/series", () => ({ replaceAssetLinks: mockReplaceAssetLinks }));

const mockCreateAsset = vi.hoisted(() =>
  vi.fn(async (input: { type: string; name: string }) => ({
    id: "new-asset-1",
    type: input.type,
    name: input.name,
  })),
);
const mockAssetVariantPath = vi.hoisted(() =>
  vi.fn(
    (type: string, id: string, variantId: string, ext = ".png") =>
      `data/assets/${type}/${id}/variant-${variantId}${ext}`,
  ),
);
const mockAddAssetVariant = vi.hoisted(() => vi.fn(async () => ({})));
const mockDeleteAsset = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/assets", () => ({
  createAsset: mockCreateAsset,
  assetVariantPath: mockAssetVariantPath,
  addAssetVariant: mockAddAssetVariant,
  deleteAsset: mockDeleteAsset,
}));

import { extendSubject, type ExtendBaseAsset } from "@/pipeline/subject-extend";

const base = (over: Partial<ExtendBaseAsset> = {}): ExtendBaseAsset => ({
  id: "c1",
  type: "character",
  name: "杨过",
  appearance: "白衣剑客",
  keywords: "杨过, 剑",
  primaryImage: "data/assets/character/c1/view-01.png",
  styleId: "",
  styleName: "",
  ...over,
});

describe("extendSubject", () => {
  beforeEach(() => {
    mockGenerateObject.mockClear();
    mockCallImageEdits.mockClear();
    mockReplaceAssetLinks.mockClear();
    mockCreateAsset.mockClear();
    mockAddAssetVariant.mockClear();
    mockDeleteAsset.mockClear();
  });

  it("creates new asset via LLM + img2img and emits SSE events", async () => {
    const events: Array<Record<string, unknown>> = [];
    const newId = await extendSubject(base(), "帮我生成小龙女", (ev) =>
      events.push(ev as Record<string, unknown>),
    );
    expect(newId).toBe("new-asset-1");
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
    // 人设三字段透传给 createAsset
    expect(mockCreateAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "小龙女",
        characterProfile: "守古墓的仙子，身世神秘",
        personality: "外冷内热",
        traits: "发间常别一支白玉簪",
      }),
    );
    // img2img 参考 = 原主体主形象图；结果写入主形象变体
    const genPath = mockCallImageEdits.mock.calls[0][2] as string;
    expect(genPath).toMatch(/^data[\\/]assets[\\/]character[\\/]new-asset-1[\\/]variant-.*\.png$/);
    expect(mockCallImageEdits).toHaveBeenCalledWith(
      expect.stringContaining("小龙女"),
      ["data/assets/character/c1/view-01.png"],
      genPath,
    );
    expect(mockAddAssetVariant).toHaveBeenCalledWith(
      "new-asset-1",
      expect.objectContaining({
        name: "主形象",
        appearance: "白发红衣，清冷气质",
        image: genPath,
        styleId: "",
      }),
    );
    expect(events.some((e) => e.type === "profile")).toBe(true);
    expect(events.some((e) => e.type === "done" && e.assetId === "new-asset-1")).toBe(true);
    // 未指定合集：不写合集关联
    expect(mockReplaceAssetLinks).not.toHaveBeenCalled();
  });

  it("with series: style image as ref + asset linked into series with role", async () => {
    const events: Array<Record<string, unknown>> = [];
    await extendSubject(
      base({ characterProfile: "江湖少侠", personality: "桀骜不驯", traits: "右臂缠绷带" }),
      "给合集生成新角色",
      (ev) => events.push(ev as Record<string, unknown>),
      {
        id: "s1",
        name: "江湖录",
        intro: "武侠世界",
        role: "protagonist",
        styleId: "st1",
        styleName: "Q版仙侠",
        stylePreset: "简约线条",
        styleImage: "data/assets/style/s1/view-01.png",
        existing: [{ name: "杨过", characterProfile: "江湖少侠" }],
      },
    );
    // 画风图作为第一参考图
    expect(mockCallImageEdits).toHaveBeenCalledWith(
      expect.any(String),
      ["data/assets/style/s1/view-01.png", "data/assets/character/c1/view-01.png"],
      expect.any(String),
    );
    // prompt 注入了合集上下文与已有角色（防重复）
    const promptArg = mockGenerateObject.mock.calls.at(-1)![0] as { prompt: string };
    expect(promptArg.prompt).toContain("江湖录");
    expect(promptArg.prompt).toContain("已有角色");
    // 新资产写入合集关联，且变体沿用合集画风
    expect(mockReplaceAssetLinks).toHaveBeenCalledWith("new-asset-1", [
      { seriesId: "s1", role: "protagonist" },
    ]);
    expect(mockAddAssetVariant).toHaveBeenCalledWith(
      "new-asset-1",
      expect.objectContaining({ styleId: "st1", styleName: "Q版仙侠" }),
    );
    const done = events.find((e) => e.type === "done");
    expect(done?.seriesId).toBe("s1");
    expect(done?.seriesName).toBe("江湖录");
    expect(done?.seriesRole).toBe("protagonist");
  });

  it("rejects style type", async () => {
    await expect(
      extendSubject(
        base({
          id: "s1",
          type: "style",
          name: "水墨",
          appearance: "",
          keywords: "",
          primaryImage: "data/assets/style/s1/view-01.png",
        }),
        "test",
        () => {},
      ),
    ).rejects.toThrow("画风主体不支持扩展");
  });

  it("scene with series: 固定常设场景身份，入合集并防重名", async () => {
    const events: Array<Record<string, unknown>> = [];
    await extendSubject(
      base({
        id: "sc1",
        type: "scene",
        name: "古墓",
        appearance: "石室",
        keywords: "古墓",
        primaryImage: "data/assets/scene/sc1/view-01.png",
      }),
      "给合集生成新场景",
      (ev) => events.push(ev as Record<string, unknown>),
      {
        id: "s1",
        name: "江湖录",
        intro: "",
        role: "scene",
        styleId: "st1",
        styleName: "Q版仙侠",
        stylePreset: null,
        styleImage: "data/assets/style/s1/view-01.png",
        existing: [{ name: "古墓", characterProfile: "" }],
      },
    );
    // 画风参考图 + 原场景图
    expect(mockCallImageEdits).toHaveBeenCalledWith(
      expect.any(String),
      ["data/assets/style/s1/view-01.png", "data/assets/scene/sc1/view-01.png"],
      expect.any(String),
    );
    // prompt 注入已有场景（防重名/设定雷同）与空镜要求
    const promptArg = mockGenerateObject.mock.calls.at(-1)![0] as { prompt: string };
    expect(promptArg.prompt).toContain("已有场景");
    expect(promptArg.prompt).toContain("画面中不出现角色");
    // 以常设场景身份入合集
    expect(mockReplaceAssetLinks).toHaveBeenCalledWith("new-asset-1", [
      { seriesId: "s1", role: "scene" },
    ]);
    const done = events.find((e) => e.type === "done");
    expect(done?.seriesRole).toBe("scene");
  });

  it("rejects scene with non-scene series role", async () => {
    await expect(
      extendSubject(
        base({
          id: "sc1",
          type: "scene",
          name: "古墓",
          appearance: "石室",
          keywords: "古墓",
          primaryImage: "data/assets/scene/sc1/view-01.png",
        }),
        "test",
        () => {},
        {
          id: "s1",
          name: "S",
          intro: "",
          role: "member",
          styleId: null,
          styleName: null,
          stylePreset: null,
          styleImage: null,
          existing: [],
        },
      ),
    ).rejects.toThrow("场景扩展加入合集时身份固定为常设场景");
  });

  it("rolls back asset when image generation fails", async () => {
    mockCallImageEdits.mockRejectedValueOnce(new Error("boom"));
    await expect(
      extendSubject(base({ appearance: "", keywords: "" }), "生成新角色", () => {}),
    ).rejects.toThrow("boom");
    expect(mockDeleteAsset).toHaveBeenCalledWith("new-asset-1");
    expect(mockReplaceAssetLinks).not.toHaveBeenCalled();
    expect(mockAddAssetVariant).not.toHaveBeenCalled();
  });

  it("throws when base has no reference image", async () => {
    expect(extendSubject(base({ primaryImage: null }), "生成新角色", () => {})).rejects.toThrow(
      "原主体没有参考图",
    );
  });
});
