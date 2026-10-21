import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const assetsById = vi.hoisted(() => new Map<string, any>());
const mockFindUnique = vi.hoisted(() =>
  vi.fn(async ({ where }: { where: { id: string } }) => assetsById.get(where.id) ?? null),
);
const mockTouchUsage = vi.hoisted(() => vi.fn(async () => {}));
const mockAddAssetVariant = vi.hoisted(() => vi.fn(async () => ({})));
const mockChat = vi.hoisted(() =>
  vi.fn(
    async (_biz: string, _messages: Array<{ role: string; content: string }>): Promise<string> =>
      JSON.stringify({ appearances: { 小龙女: "白衣女子，长发，清冷气质" } }),
  ),
);

vi.mock("@/model-manager", () => ({
  chatCompletionForBiz: mockChat,
}));

vi.mock("@/lib/db", () => ({
  db: {
    asset: { findUnique: mockFindUnique },
    task: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/assets", () => ({
  touchUsage: mockTouchUsage,
  addAssetVariant: mockAddAssetVariant,
  parseVariants: (json: string | null | undefined) => {
    try {
      const arr = JSON.parse(json ?? "[]");
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  },
  assetVariantPath: (type: string, id: string, variantId: string, ext = ".png") =>
    `data/assets/${type}/${id}/variant-${variantId}${ext}`,
}));

const mockSceneView = vi.hoisted(() =>
  vi.fn(async (_d: string, _p: string, outPath: string) => ({
    path: outPath,
    width: 1024,
    height: 1024,
  })),
);
const mockCharView = vi.hoisted(() =>
  vi.fn(async (_n: string, _a: string, _p: string, outPath: string) => ({
    path: outPath,
    width: 1024,
    height: 1024,
  })),
);
vi.mock("@/pipeline/artist", () => ({
  generateSceneView: mockSceneView,
  generateCharacterView: mockCharView,
}));

import { resolveSubjects } from "@/pipeline/subject-bind";
import type { SubjectBindings } from "@/pipeline/subjects";

const script = {
  panels: [
    { scene: "古城门前", character: "杨过", dialogue: "走" },
    { scene: "古城门前", character: "小龙女", dialogue: "跟上" },
  ],
};

const V = (id: string, styleId: string, styleName: string, appearance: string, image: string) => ({
  id,
  name: styleId ? "仙侠形象" : "主形象",
  styleId,
  styleName,
  appearance,
  image,
});

const charAsset = (variants: Array<ReturnType<typeof V>>) => ({
  id: "c1",
  type: "character",
  name: "杨过",
  variantsJson: JSON.stringify(variants),
});

const styleAsset = (id: string, name: string, img: string, preset: string) => ({
  id,
  type: "style",
  name,
  imagePathsJson: JSON.stringify([img]),
  stylePreset: preset,
});

const MAIN_V1 = V("v1", "", "", "白衣", "data/assets/character/c1/view-01.png");
const S1_V2 = V("v2", "s1", "Q版仙侠", "白衣", "data/assets/character/c1/variant-v2.png");

beforeEach(() => {
  assetsById.clear();
  mockFindUnique.mockClear();
  mockTouchUsage.mockClear();
  mockAddAssetVariant.mockClear();
  mockSceneView.mockClear();
  mockCharView.mockClear();
  mockChat.mockClear();
});

describe("resolveSubjects", () => {
  it("binds assets and generates missing ones at deterministic paths", async () => {
    assetsById.set("c1", charAsset([MAIN_V1]));
    const bindings: SubjectBindings = {
      scene: { name: "古城门前", assetId: null },
      characters: [
        { name: "杨过", assetId: "c1" },
        { name: "小龙女", assetId: null },
      ],
    };
    const refs = await resolveSubjects("t1", script, bindings, () => {});
    expect(refs.characters[0].assetId).toBe("c1");
    expect(refs.characters[0].image).toBe("data/assets/character/c1/view-01.png");
    expect(refs.characters[1].assetId).toBeNull();
    expect(refs.characters[1].image).toBe(path.join("data", "images", "t1", "subjects", "c1.png"));
    expect(refs.scene.assetId).toBeNull();
    // 主场景不再自动文生图：未绑定资产时 scene.image 保持 null
    expect(refs.scene.image).toBeNull();
    expect(refs.scene.name).toBe("古城门前");
    expect(refs.style?.assetId).toBeNull();
    expect(refs.style?.image).toBeNull();
    expect(refs.style?.preset).toBeTruthy();
    expect(mockTouchUsage).toHaveBeenCalledWith("c1");
    expect(mockCharView).toHaveBeenCalledTimes(1);
    expect(mockSceneView).not.toHaveBeenCalled();
    // 未绑定角色由 LLM 补全外观，并写入三视图 prompt 与 refs 持久化字段
    expect(mockChat).toHaveBeenCalledTimes(1);
    const llmPrompt = mockChat.mock.calls[0][1][1].content;
    expect(llmPrompt).toContain("小龙女");
    expect(refs.characters[1].appearance).toBe("白衣女子，长发，清冷气质");
    expect(mockCharView.mock.calls[0][1]).toBe("白衣女子，长发，清冷气质");
  });

  it("装扮优先于 LLM 补全；提示词覆盖的角色不调 LLM", async () => {
    const scriptWithOutfit = { ...script, outfits: { 杨过: "白衣剑客青年" } };
    const bindings: SubjectBindings = {
      scene: { name: "古城门前", assetId: null },
      characters: [
        { name: "杨过", assetId: null },
        { name: "小龙女", assetId: null },
      ],
    };
    const refs = await resolveSubjects("t8", scriptWithOutfit, bindings, () => {}, {
      characters: { 小龙女: "全量自定义提示词" },
    });
    expect(mockChat).not.toHaveBeenCalled();
    expect(refs.characters[0].appearance).toBe("白衣剑客青年");
    expect(mockCharView.mock.calls[0][1]).toBe("白衣剑客青年");
    expect(refs.characters[1].appearance).toBeNull();
  });

  it("resolves explicit variant image when binding specifies variantId", async () => {
    assetsById.set("c1", charAsset([MAIN_V1, S1_V2]));
    const bindings: SubjectBindings = {
      scene: { name: "古城门前", assetId: null },
      characters: [{ name: "杨过", assetId: "c1", variantId: "v2" }],
    };
    const refs = await resolveSubjects("t2", script, bindings, () => {});
    expect(refs.characters[0].image).toBe("data/assets/character/c1/variant-v2.png");
  });

  it("uses style-matched variant when episode style matches (no regen)", async () => {
    assetsById.set("c1", charAsset([MAIN_V1, S1_V2]));
    assetsById.set(
      "s1",
      styleAsset("s1", "Q版仙侠", "data/assets/style/s1/view-01.png", "Q版仙侠"),
    );
    const bindings: SubjectBindings = {
      style: { assetId: "s1", preset: "Q版仙侠" },
      scene: { name: "古城门前", assetId: null },
      characters: [{ name: "杨过", assetId: "c1" }],
    };
    const refs = await resolveSubjects("t3", script, bindings, () => {});
    expect(refs.style?.image).toBe("data/assets/style/s1/view-01.png");
    expect(refs.characters[0].image).toBe("data/assets/character/c1/variant-v2.png");
    expect(mockCharView).not.toHaveBeenCalled();
    expect(mockAddAssetVariant).not.toHaveBeenCalled();
  });

  it("generates missing style variant and writes it back to asset", async () => {
    assetsById.set(
      "c1",
      charAsset([V("v1", "", "", "白衣剑客", "data/assets/character/c1/view-01.png")]),
    );
    assetsById.set(
      "s1",
      styleAsset("s1", "Q版仙侠", "data/assets/style/s1/view-01.png", "Q版仙侠"),
    );
    const bindings: SubjectBindings = {
      style: { assetId: "s1", preset: "Q版仙侠" },
      scene: { name: "古城门前", assetId: null },
      characters: [{ name: "杨过", assetId: "c1" }],
    };
    const refs = await resolveSubjects("t4", script, bindings, () => {});
    const genPath = mockCharView.mock.calls[0][3] as string;
    expect(genPath).toMatch(/data[\\/]assets[\\/]character[\\/]c1[\\/]variant-.*\.png/);
    expect(refs.characters[0].image).toBe(genPath);
    expect(mockCharView).toHaveBeenCalledWith("杨过", "白衣剑客", "Q版仙侠", genPath);
    expect(mockAddAssetVariant).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({
        styleId: "s1",
        styleName: "Q版仙侠",
        appearance: "白衣剑客",
        image: genPath,
      }),
    );
  });

  it("scene: uses style-matched variant for the bound scene asset", async () => {
    assetsById.set("sc1", {
      id: "sc1",
      type: "scene",
      name: "古城门前",
      variantsJson: JSON.stringify([
        V("v1", "", "", "古城", "data/assets/scene/sc1/view-01.png"),
        V("v2", "s1", "Q版仙侠", "古城", "data/assets/scene/sc1/variant-v2.png"),
      ]),
    });
    assetsById.set(
      "s1",
      styleAsset("s1", "Q版仙侠", "data/assets/style/s1/view-01.png", "Q版仙侠"),
    );
    const bindings: SubjectBindings = {
      style: { assetId: "s1", preset: "Q版仙侠" },
      scene: { name: "古城门前", assetId: "sc1" },
      characters: [],
    };
    const refs = await resolveSubjects("t5", script, bindings, () => {});
    expect(refs.scene.assetId).toBe("sc1");
    expect(refs.scene.image).toBe("data/assets/scene/sc1/variant-v2.png");
    expect(mockSceneView).not.toHaveBeenCalled();
  });

  it("scene: 优先用用户编辑的说明描述，留空回退剧本首格画面", async () => {
    const edited = await resolveSubjects(
      "t6",
      script,
      { scene: { name: "雪夜山道", assetId: null }, characters: [] },
      () => {},
    );
    expect(edited.scene.name).toBe("雪夜山道");
    const blank = await resolveSubjects(
      "t7",
      script,
      { scene: { name: "   ", assetId: null }, characters: [] },
      () => {},
    );
    expect(blank.scene.name).toBe("古城门前");
  });
});
