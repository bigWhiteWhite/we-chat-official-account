import { describe, expect, it } from "vitest";

import { getPageItems } from "@/lib/pagination";

describe("getPageItems", () => {
  it("不超过 7 页时展示全部页码", () => {
    expect(getPageItems(1, 1)).toEqual([1]);
    expect(getPageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("首尾页无对应方向的省略号", () => {
    expect(getPageItems(1, 10)).toEqual([1, 2, "ellipsis", 10]);
    expect(getPageItems(10, 10)).toEqual([1, "ellipsis", 9, 10]);
  });

  it("中间页两侧带省略号", () => {
    expect(getPageItems(5, 10)).toEqual([1, "ellipsis", 4, 5, 6, "ellipsis", 10]);
  });
});
