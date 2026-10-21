import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { WeixinApiError } from "@/pipeline/weixin/draft";
import { setupTempDb, type TempDb } from "./helpers/test-db";

let tdb: TempDb;

beforeAll(() => {
  tdb = setupTempDb();
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
}, 30_000);

describe("buildArticleHtml", () => {
  const script = {
    title: "测试",
    theme: "职场",
    punchline: "爆点句",
    panels: [
      { scene: "画面1", dialogue: "台词1" },
      { scene: "画面2", dialogue: "台词2" },
    ],
  };

  it("输出题材徽章、图片与图下说明，不含台词、爆点或互动引导", async () => {
    const { buildArticleHtml } = await import("@/pipeline/weixin/draft");
    const html = buildArticleHtml(script, ["http://a/1.jpg", "http://a/2.jpg"], ["自定义图注", ""]);
    expect(html).toContain("职场");
    expect(html).toContain('src="http://a/1.jpg"');
    expect(html).toContain('src="http://a/2.jpg"');
    expect(html).toContain("自定义图注");
    expect(html).not.toContain("台词1");
    expect(html).not.toContain("台词2");
    expect(html).not.toContain("爆点句");
    expect(html).not.toContain("在看");
  });

  it("渲染导语且说明位于对应图片下方", async () => {
    const { buildArticleHtml } = await import("@/pipeline/weixin/draft");
    const html = buildArticleHtml(
      script,
      ["http://a/1.jpg", "http://a/2.jpg"],
      ["说明一", "说明二"],
      "这是整篇导语",
    );
    expect(html).toContain("这是整篇导语");
    expect(html).toContain("说明一");
    expect(html).toContain("说明二");
    const introIdx = html.indexOf("这是整篇导语");
    const img1Idx = html.indexOf('src="http://a/1.jpg"');
    const cap1Idx = html.indexOf("说明一");
    expect(introIdx).toBeLessThan(img1Idx);
    expect(img1Idx).toBeLessThan(cap1Idx);
  });

  it("台词/画面不再回退为图注", async () => {
    const { buildArticleHtml } = await import("@/pipeline/weixin/draft");
    const noDialogue = {
      ...script,
      panels: [
        { scene: "仅画面", dialogue: "" },
        { scene: "画面2", dialogue: "" },
      ],
    };
    const html = buildArticleHtml(noDialogue, ["http://a/1.jpg"]);
    expect(html).toContain('src="http://a/1.jpg"');
    expect(html).not.toContain("仅画面");
  });

  it("超 2 万字符抛错", async () => {
    const { buildArticleHtml } = await import("@/pipeline/weixin/draft");
    const many = {
      ...script,
      panels: script.panels.map((p) => ({ ...p, scene: "面".repeat(60) })),
    };
    const urls = Array.from({ length: 300 }, (_, i) => `http://x/${"a".repeat(80)}${i}.jpg`);
    expect(() => buildArticleHtml(many, urls)).toThrow(/20000/);
  });
});

describe("extractInvalidIp", () => {
  it("从 40164 errmsg 提取出口 IP", async () => {
    const { extractInvalidIp } = await import("@/pipeline/weixin/token");
    expect(extractInvalidIp("invalid ip 112.94.5.86, not in whitelist rid: 123")).toBe(
      "112.94.5.86",
    );
  });

  it("errmsg 无 IP 时返回 null", async () => {
    const { extractInvalidIp } = await import("@/pipeline/weixin/token");
    expect(extractInvalidIp("invalid ip, not in whitelist")).toBeNull();
    expect(extractInvalidIp(undefined)).toBeNull();
  });
});

describe("compressForWeixin", () => {
  it("≤10MB 原样返回", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wx-"));
    const p = path.join(dir, "small.png");
    writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const { compressForWeixin } = await import("@/pipeline/weixin/media");
    await expect(compressForWeixin(p)).resolves.toBe(p);
  });
});

describe("getAccessToken 缓存", () => {
  it("有效期内命中缓存不请求微信", async () => {
    const { db } = await import("@/lib/db");
    const { getAppId } = await import("@/lib/business-settings");
    await db.tokenCache.create({
      data: {
        key: getAppId(),
        accessToken: "cached-token",
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("不应发起网络请求"));
    const { getAccessToken } = await import("@/pipeline/weixin/token");
    await expect(getAccessToken()).resolves.toBe("cached-token");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    await db.$disconnect();
  });
});

describe("addDraft", () => {
  it("请求 draft/add 时携带缓存的 access_token", async () => {
    const { db } = await import("@/lib/db");
    const { getAppId } = await import("@/lib/business-settings");
    await db.tokenCache.upsert({
      where: { key: getAppId() },
      create: {
        key: getAppId(),
        accessToken: "draft-token",
        expiresAt: new Date(Date.now() + 3600_000),
      },
      update: { accessToken: "draft-token", expiresAt: new Date(Date.now() + 3600_000) },
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ media_id: "MEDIA_123" }), { status: 200 }));
    const { addDraft } = await import("@/pipeline/weixin/draft");
    const r = await addDraft({
      title: "标题",
      author: "作者",
      content: "<p>x</p>",
      thumbMediaId: "THUMB",
    });
    expect(r.mediaId).toBe("MEDIA_123");
    expect(r.feedback).toEqual({ errcode: 0, errmsg: "ok" });
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain("/cgi-bin/draft/add?access_token=draft-token");
    fetchSpy.mockRestore();
    await db.$disconnect();
  });

  it("errcode 非 0 时抛 WeixinApiError 并保留原始反馈", async () => {
    const { db } = await import("@/lib/db");
    const { getAppId } = await import("@/lib/business-settings");
    await db.tokenCache.upsert({
      where: { key: getAppId() },
      create: {
        key: getAppId(),
        accessToken: "draft-token",
        expiresAt: new Date(Date.now() + 3600_000),
      },
      update: { accessToken: "draft-token", expiresAt: new Date(Date.now() + 3600_000) },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errcode: 40001, errmsg: "invalid credential" }), {
        status: 200,
      }),
    );
    const { addDraft, WeixinApiError } = await import("@/pipeline/weixin/draft");
    let err: unknown;
    try {
      await addDraft({ title: "标题", author: "作者", content: "<p>x</p>", thumbMediaId: "THUMB" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(WeixinApiError);
    expect((err as WeixinApiError).feedback).toEqual({
      errcode: 40001,
      errmsg: "invalid credential",
    });
    fetchSpy.mockRestore();
    await db.$disconnect();
  });

  it("payload 携带 digest 字段，缺省为空串", async () => {
    const { db } = await import("@/lib/db");
    const { getAppId } = await import("@/lib/business-settings");
    await db.tokenCache.upsert({
      where: { key: getAppId() },
      create: {
        key: getAppId(),
        accessToken: "draft-token",
        expiresAt: new Date(Date.now() + 3600_000),
      },
      update: { accessToken: "draft-token", expiresAt: new Date(Date.now() + 3600_000) },
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ media_id: "MEDIA_123" }), { status: 200 })),
      );
    const { addDraft } = await import("@/pipeline/weixin/draft");
    await addDraft({
      title: "标题",
      author: "作者",
      content: "<p>x</p>",
      thumbMediaId: "THUMB",
      digest: "摘要",
    });
    const opts = fetchSpy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(opts.body as string);
    expect(body.articles[0].digest).toBe("摘要");

    await addDraft({ title: "标题", author: "作者", content: "<p>x</p>", thumbMediaId: "THUMB" });
    const opts2 = fetchSpy.mock.calls[1]![1] as RequestInit;
    const body2 = JSON.parse(opts2.body as string);
    expect(body2.articles[0].digest).toBe("");
    fetchSpy.mockRestore();
    await db.$disconnect();
  });

  it("40164 时自动失效缓存 token 并重试一次成功（无需手动再点）", async () => {
    const { db } = await import("@/lib/db");
    const { getAppId } = await import("@/lib/business-settings");
    await db.tokenCache.upsert({
      where: { key: getAppId() },
      create: {
        key: getAppId(),
        accessToken: "stale-token",
        expiresAt: new Date(Date.now() + 3600_000),
      },
      update: { accessToken: "stale-token", expiresAt: new Date(Date.now() + 3600_000) },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/cgi-bin/token")) {
        return new Response(JSON.stringify({ access_token: "fresh-token", expires_in: 7200 }), {
          status: 200,
        });
      }
      if (url.includes("access_token=stale-token")) {
        return new Response(
          JSON.stringify({ errcode: 40164, errmsg: "invalid ip 1.2.3.4, not in whitelist rid: x" }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ media_id: "MEDIA_NEW" }), { status: 200 });
    });
    const { addDraft } = await import("@/pipeline/weixin/draft");
    const r = await addDraft({
      title: "标题",
      author: "作者",
      content: "<p>x</p>",
      thumbMediaId: "THUMB",
    });
    expect(r.mediaId).toBe("MEDIA_NEW");
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain("access_token=stale-token");
    expect(urls[1]).toContain("/cgi-bin/token");
    expect(urls[2]).toContain("access_token=fresh-token");
    fetchSpy.mockRestore();
    await db.$disconnect();
  });

  it("重试后 IP 仍不在白名单则抛带出口 IP 的 40164 错误（不死循环）", async () => {
    const { db } = await import("@/lib/db");
    const { getAppId } = await import("@/lib/business-settings");
    await db.tokenCache.upsert({
      where: { key: getAppId() },
      create: {
        key: getAppId(),
        accessToken: "stale-token",
        expiresAt: new Date(Date.now() + 3600_000),
      },
      update: { accessToken: "stale-token", expiresAt: new Date(Date.now() + 3600_000) },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            errcode: 40164,
            errmsg: "invalid ip 9.9.9.9, not in whitelist rid: x",
          }),
          { status: 200 },
        ),
    );
    const { addDraft } = await import("@/pipeline/weixin/draft");
    await expect(
      addDraft({ title: "标题", author: "作者", content: "<p>x</p>", thumbMediaId: "THUMB" }),
    ).rejects.toThrow(/40164.*9\.9\.9\.9/);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
    await db.$disconnect();
  });
});
