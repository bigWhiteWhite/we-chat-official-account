import { describe, expect, it } from "vitest";

import type { ComicScript } from "@/pipeline/schema";
import { sceneName, splitNames, uniqueCast } from "@/pipeline/schema";
import {
  buildAppearancesPrompt,
  buildExtendImagePrompt,
  buildMatchPrompt,
} from "@/pipeline/prompts/subjects";
import {
  buildPanelRefs,
  normalizeMatch,
  parseTaskReferences,
  stylePresetFor,
  type TaskReferences,
} from "@/pipeline/subjects";

const script = {
  title: "过五关",
  source: "self-made",
  source_url: "",
  theme: "武侠",
  target_panels: 2,
  panels: [
    { scene: "古城门前", character: "杨过、小龙女", dialogue: "走" },
    { scene: "古城门前", character: "杨过", dialogue: "跟上" },
  ],
  punchline: "",
  risk_tags: [],
} as unknown as ComicScript;

const refs: TaskReferences = {
  style: { assetId: "st1", preset: "水墨风", image: "data/assets/style/st1/view-01.png" },
  scene: { assetId: "sc1", name: "古城门前", image: "data/assets/scene/sc1/view-01.png" },
  characters: [
    { name: "杨过", assetId: "c1", image: "data/assets/character/c1/view-01.png" },
    {
      name: "小龙女",
      assetId: null,
      image: "data/images/t1/subjects/c1.png",
      appearance: "白衣女子",
    },
  ],
};

describe("splitNames / uniqueCast / sceneName", () => {
  it("splits by 、 and ， and dedupes cast", () => {
    expect(splitNames("杨过、小龙女")).toEqual(["杨过", "小龙女"]);
    expect(splitNames("杨过, 小龙女")).toEqual(["杨过", "小龙女"]);
    expect(uniqueCast(script)).toEqual(["杨过", "小龙女"]);
    expect(sceneName(script)).toBe("古城门前");
  });
});

describe("buildPanelRefs", () => {
  it("panel 0: style + both characters + scene, in order", () => {
    expect(buildPanelRefs(script, refs, 0)).toEqual([
      "data/assets/style/st1/view-01.png",
      "data/assets/character/c1/view-01.png",
      "data/images/t1/subjects/c1.png",
      "data/assets/scene/sc1/view-01.png",
    ]);
  });
  it("panel 1: only 杨过", () => {
    expect(buildPanelRefs(script, refs, 1)).toEqual([
      "data/assets/style/st1/view-01.png",
      "data/assets/character/c1/view-01.png",
      "data/assets/scene/sc1/view-01.png",
    ]);
  });
  it("out of range returns empty", () => {
    expect(buildPanelRefs(script, refs, 99)).toEqual([]);
  });
});

describe("parseTaskReferences", () => {
  it("parses new format", () => {
    const r = parseTaskReferences(JSON.stringify(refs));
    expect(r.kind).toBe("new");
    if (r.kind === "new") {
      expect(r.refs.characters).toHaveLength(2);
      expect(r.refs.characters[1].appearance).toBe("白衣女子");
      expect(r.refs.characters[0].appearance).toBeNull();
    }
  });
  it("parses legacy flat format", () => {
    const r = parseTaskReferences(JSON.stringify({ character: "a.png", scene: "b.png" }));
    expect(r.kind).toBe("legacy");
    if (r.kind === "legacy") expect(r.paths.scene).toBe("b.png");
  });
  it("null or invalid json yields none", () => {
    expect(parseTaskReferences(null).kind).toBe("none");
    expect(parseTaskReferences("not json").kind).toBe("none");
  });
});

describe("stylePresetFor", () => {
  it("prefers asset preset, falls back otherwise", () => {
    expect(stylePresetFor(refs, "简约线条")).toBe("水墨风");
    expect(stylePresetFor({ ...refs, style: undefined }, "简约线条")).toBe("简约线条");
    expect(stylePresetFor(null, "简约线条")).toBe("简约线条");
  });
});

describe("buildMatchPrompt / normalizeMatch", () => {
  it("prompt contains cast and asset rows", () => {
    const p = buildMatchPrompt(script, [
      { id: "c1", type: "character", name: "杨过", appearance: "白衣", keywords: "杨过, 武侠" },
    ]);
    expect(p).toContain("杨过");
    expect(p).toContain("[c1]");
  });
  it("normalizeMatch filters invalid ids and fills missing cast", () => {
    const b = normalizeMatch(
      {
        style: { assetId: "ghost" },
        scene: { name: "古城门前", assetId: "sc1" },
        characters: [
          { name: "杨过", assetId: "c1" },
          { name: "随机路人", assetId: "c9" },
        ],
      },
      script,
      new Set(["c1", "sc1", "st1"]),
    );
    expect(b.style).toBeUndefined();
    expect(b.scene).toEqual({ name: "古城门前", assetId: "sc1" });
    expect(b.characters).toEqual([
      { name: "杨过", assetId: "c1" },
      { name: "小龙女", assetId: null },
    ]);
  });
});

describe("buildAppearancesPrompt", () => {
  it("含剧本、目标角色与装扮，要求忠实剧本与纯 JSON", () => {
    const { system, prompt } = buildAppearancesPrompt(
      { ...script, outfits: { 杨过: "白衣剑客" } },
      ["杨过", "小龙女"],
    );
    expect(system).toContain("漫画美术设定师");
    expect(prompt).toContain("过五关");
    expect(prompt).toContain("杨过、小龙女");
    expect(prompt).toContain("古城门前");
    expect(prompt).toContain("杨过：白衣剑客");
    expect(prompt).toContain('"appearances"');
  });
});

describe("buildExtendImagePrompt", () => {
  it("character yields 三视图, scene yields 场景参考图", () => {
    expect(buildExtendImagePrompt("character", { name: "小龙女", appearance: "白发" })).toContain(
      "三视图",
    );
    expect(buildExtendImagePrompt("scene", { name: "古墓", appearance: "石室" })).toContain(
      "场景参考图",
    );
  });
});
