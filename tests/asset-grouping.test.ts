import { describe, expect, it } from "vitest";

import { groupAssetsBySeries } from "@/lib/asset-grouping";
import type { AssetSummary } from "@/lib/api";

function fakeAsset(partial: Partial<AssetSummary> & { id: string; name: string }): AssetSummary {
  return {
    type: "character",
    imagePrompt: "",
    keywords: "",
    imagePaths: [],
    outfits: [],
    stylePreset: null,
    sourceTaskId: null,
    usageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    seriesLinks: [],
    ...partial,
  } as AssetSummary;
}

describe("groupAssetsBySeries", () => {
  it("按资产第一个合集关联分组，无关联归入未归类", () => {
    const a = fakeAsset({
      id: "a",
      name: "阿强",
      seriesLinks: [
        { seriesId: "s1", seriesName: "甲系列", role: "protagonist" },
        { seriesId: "s2", seriesName: "乙系列", role: "member" },
      ],
    });
    const b = fakeAsset({
      id: "b",
      name: "乙猫",
      seriesLinks: [{ seriesId: "s2", seriesName: "乙系列", role: "protagonist" }],
    });
    const c = fakeAsset({ id: "c", name: "丙" });
    const groups = groupAssetsBySeries([a, b, c]);
    expect(groups.map((g) => g.label)).toEqual(["甲系列", "乙系列", "未归类"]);
    expect(groups[0]!.seriesId).toBe("s1");
    expect(groups[0]!.assets.map((x) => x.id)).toEqual(["a"]);
    expect(groups[1]!.assets.map((x) => x.id)).toEqual(["b"]);
    expect(groups[2]!.seriesId).toBeNull();
    expect(groups[2]!.assets.map((x) => x.id)).toEqual(["c"]);
  });

  it("primarySeriesId 对应分组置顶，其余按名称中文排序，未归类最后", () => {
    const a = fakeAsset({
      id: "a",
      name: "A",
      seriesLinks: [{ seriesId: "s1", seriesName: "乙", role: "protagonist" }],
    });
    const b = fakeAsset({
      id: "b",
      name: "B",
      seriesLinks: [{ seriesId: "s2", seriesName: "甲", role: "protagonist" }],
    });
    const groups = groupAssetsBySeries([a, b], "s2");
    expect(groups.map((g) => g.seriesId)).toEqual(["s2", "s1", null]);
  });

  it("组内资产按名称排序；空输入仅含未归类", () => {
    const a = fakeAsset({
      id: "a",
      name: "乙",
      seriesLinks: [{ seriesId: "s1", seriesName: "S", role: "protagonist" }],
    });
    const b = fakeAsset({
      id: "b",
      name: "甲",
      seriesLinks: [{ seriesId: "s1", seriesName: "S", role: "protagonist" }],
    });
    const groups = groupAssetsBySeries([a, b]);
    expect(groups[0]!.assets.map((x) => x.id)).toEqual(["b", "a"]);
    expect(groupAssetsBySeries([]).map((g) => g.label)).toEqual(["未归类"]);
  });
});
