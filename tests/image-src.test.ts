import { describe, expect, it } from "vitest";

import { bustImageCache, imageSrc } from "@/lib/api";

describe("imageSrc / bustImageCache", () => {
  it("同一路径多次调用 URL 稳定（轮询重渲染不重复请求）", () => {
    const a = imageSrc("data/images/t1/panel-01.png");
    const b = imageSrc("data/images/t1/panel-01.png");
    expect(a).toBe(b);
    expect(a).toContain("path=data%2Fimages%2Ft1%2Fpanel-01.png");
    expect(a).toMatch(/v=\d+$/);
  });

  it("data: URL 直接透传", () => {
    const url = "data:image/png;base64,AAAA";
    expect(imageSrc(url)).toBe(url);
  });

  it("单路径 bust 只影响该路径", () => {
    const p1 = "data/images/t2/panel-01.png";
    const p2 = "data/images/t2/panel-02.png";
    const before1 = imageSrc(p1);
    const before2 = imageSrc(p2);
    bustImageCache(p1);
    expect(imageSrc(p1)).not.toBe(before1);
    expect(imageSrc(p2)).toBe(before2);
  });

  it("全局 bust 使所有路径 URL 变化，且重复 bust 持续变化", () => {
    const p = "data/images/t3/panel-01.png";
    const before = imageSrc(p);
    bustImageCache();
    const after1 = imageSrc(p);
    bustImageCache();
    const after2 = imageSrc(p);
    expect(after1).not.toBe(before);
    expect(after2).not.toBe(after1);
  });

  it("单路径 bust 后全局 bust 仍然生效（版本严格递增）", () => {
    const p = "data/images/t4/panel-01.png";
    const v1 = imageSrc(p);
    bustImageCache(p);
    const v2 = imageSrc(p);
    bustImageCache();
    const v3 = imageSrc(p);
    const num = (u: string) => Number(u.match(/v=(\d+)$/)![1]);
    expect(num(v2)).toBeGreaterThan(num(v1));
    expect(num(v3)).toBeGreaterThan(num(v2));
  });
});
