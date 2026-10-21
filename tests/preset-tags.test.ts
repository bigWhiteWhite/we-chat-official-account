import { describe, expect, it } from "vitest";

import { missingPresetTags, PRESET_TAGS } from "@/lib/preset-tags";

describe("预设内容标签", () => {
  it("标签名非空且互不重复", () => {
    const names = PRESET_TAGS.map((t) => t.name);
    expect(names.every((n) => n.trim() === n && n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it("说明书为单行非空、且不超长（会原样注入 prompt）", () => {
    for (const tag of PRESET_TAGS) {
      expect(tag.description.trim().length, tag.name).toBeGreaterThan(0);
      expect(tag.description, tag.name).not.toContain("\n");
      expect(tag.description.length, tag.name).toBeLessThanOrEqual(200);
    }
  });

  it("基调由每条自己声明，不被统一写成搞笑向", () => {
    const jokeLike = PRESET_TAGS.filter((t) => /笑点|包袱/.test(t.description));
    expect(jokeLike.length).toBeLessThanOrEqual(Math.floor(PRESET_TAGS.length / 3));
  });

  it("missingPresetTags 只返回库里缺的（同名跳过，含首尾空格归一）", () => {
    expect(missingPresetTags([])).toHaveLength(PRESET_TAGS.length);

    const all = PRESET_TAGS.map((t) => t.name);
    expect(missingPresetTags(all)).toEqual([]);

    const partial = ["职场", " 萌宠 ", "我自己加的标签"];
    const missing = missingPresetTags(partial).map((t) => t.name);
    expect(missing).toHaveLength(PRESET_TAGS.length - 2);
    expect(missing).not.toContain("职场");
    expect(missing).not.toContain("萌宠");
    expect(missing).toContain(all[5]);
  });
});
