import { describe, expect, it } from "vitest";

import { buildTaskWhere } from "@/lib/task-query";

describe("buildTaskWhere", () => {
  it("空参数返回空 where", () => {
    expect(buildTaskWhere({})).toEqual({});
  });

  it("q 同时模糊匹配 title 与 outlineText（SQLite LIKE，去首尾空格）", () => {
    const w = buildTaskWhere({ q: "  加班 " });
    expect(w.OR).toHaveLength(2);
    expect(w.OR?.[0]).toEqual({ title: { contains: "加班" } });
    expect(w.OR?.[1]).toEqual({ outlineText: { contains: "加班" } });
  });

  it("status 精确匹配（all/空 视为不过滤）", () => {
    expect(buildTaskWhere({ status: "reviewing" })).toEqual({ status: "reviewing" });
    expect(buildTaskWhere({ status: "all" })).toEqual({});
    expect(buildTaskWhere({ status: "  " })).toEqual({});
  });

  it("from/to 映射到 createdAt 范围", () => {
    const w = buildTaskWhere({ from: "2026-09-01", to: "2026-09-17" });
    expect(w.createdAt).toEqual({
      gte: new Date("2026-09-01"),
      lte: new Date("2026-09-17"),
    });
  });

  it("id 精确匹配 taskId 或 draftMediaId", () => {
    const w = buildTaskWhere({ id: "abc123" });
    expect(w.OR).toHaveLength(2);
    expect(w.OR?.[0]).toEqual({ taskId: "abc123" });
    expect(w.OR?.[1]).toEqual({ draftMediaId: "abc123" });
  });

  it("seriesId 匹配主合集或附加归属；none 哨兵要求两者皆无", () => {
    expect(buildTaskWhere({ seriesId: "s1" })).toEqual({
      OR: [{ seriesId: "s1" }, { seriesLinks: { some: { seriesId: "s1" } } }],
    });
    expect(buildTaskWhere({ seriesId: "none" })).toEqual({
      AND: [{ seriesId: null }, { seriesLinks: { none: {} } }],
    });
  });

  it("q/id 与合集筛选组合为 AND 语义", () => {
    const w = buildTaskWhere({ q: "a", seriesId: "s1" });
    expect(w.OR).toHaveLength(2);
    expect(w.AND).toEqual([
      { OR: [{ seriesId: "s1" }, { seriesLinks: { some: { seriesId: "s1" } } }] },
    ]);
  });

  it("组合条件同时生效", () => {
    const w = buildTaskWhere({ q: "a", status: "done", from: "2026-09-01", id: "x" });
    expect(w.status).toBe("done");
    expect(w.OR).toHaveLength(4);
    expect(w.createdAt).toBeDefined();
  });
});
