import { describe, expect, it } from "vitest";

import type { FeedItem } from "@/components/ai-feed";
import { reduceFeedItem } from "@/lib/use-ai-stream";

const ev = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });

describe("reduceFeedItem", () => {
  it("连续 text delta 追加到同一 live 块", () => {
    let items: FeedItem[] = [];
    items = reduceFeedItem(items, ev("text", { content: "你好" }), "完成");
    items = reduceFeedItem(items, ev("text", { content: "世界" }), "完成");
    expect(items).toHaveLength(1);
    const first = items[0];
    expect(first.type).toBe("text");
    if (first.type === "text") {
      expect(first.text).toBe("你好世界");
      expect(first.live).toBe(true);
    }
  });

  it("text/thinking 交替时互相关闭 live 块，阶段事件正常追加", () => {
    let items: FeedItem[] = [];
    items = reduceFeedItem(items, ev("thinking", { content: "想" }), "完成");
    items = reduceFeedItem(items, ev("text", { content: "说" }), "完成");
    items = reduceFeedItem(items, ev("stage", { message: "阶段1" }), "完成");
    items = reduceFeedItem(items, ev("model", { model: "m-1" }), "完成");
    items = reduceFeedItem(items, ev("done"), "剧本生成完成");
    expect(items.map((i) => i.type)).toEqual(["thinking", "text", "stage", "model", "done"]);
    const first = items[0];
    const second = items[1];
    const done = items[4];
    expect(first.type === "thinking" && first.live).toBe(false);
    expect(second.type === "text" && second.live).toBe(false);
    if (done.type === "done") expect(done.label).toBe("剧本生成完成");
  });

  it("同类型 delta 之间夹其他类型时开启新块", () => {
    let items: FeedItem[] = [];
    items = reduceFeedItem(items, ev("text", { content: "a" }), "完成");
    items = reduceFeedItem(items, ev("stage", { message: "s" }), "完成");
    items = reduceFeedItem(items, ev("text", { content: "b" }), "完成");
    expect(items.map((i) => i.type)).toEqual(["text", "stage", "text"]);
    if (items[0].type === "text") expect(items[0].text).toBe("a");
    if (items[2].type === "text") expect(items[2].text).toBe("b");
  });

  it("error / fallback / tool 事件正常落 feed", () => {
    let items: FeedItem[] = [];
    items = reduceFeedItem(items, ev("fallback", { from: "a", to: "b" }), "完成");
    items = reduceFeedItem(items, ev("tool", { name: "gen", args: { x: 1 } }), "完成");
    items = reduceFeedItem(items, ev("error", { message: "炸了" }), "完成");
    expect(items.map((i) => i.type)).toEqual(["fallback", "tool", "error"]);
    if (items[0].type === "fallback") expect(items[0].to).toBe("b");
    if (items[2].type === "error") expect(items[2].message).toBe("炸了");
  });
});
