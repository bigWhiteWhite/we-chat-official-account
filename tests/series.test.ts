import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTempDb, type TempDb } from "./helpers/test-db";

let tdb: TempDb;

beforeAll(() => {
  tdb = setupTempDb();
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
}, 30_000);

/** 测试辅助：建合集并按角色写 AssetSeriesLink（替代旧的 JSON 字段） */
async function createSeriesWithLinks(opts: {
  name: string;
  intro?: string;
  styleId?: string;
  protagonistIds?: string[];
  sceneIds?: string[];
  memberIds?: string[];
}) {
  const { db } = await import("@/lib/db");
  const s = await db.series.create({ data: { name: opts.name, intro: opts.intro ?? "" } });
  if (opts.styleId) {
    await db.assetSeriesLink.create({
      data: { assetId: opts.styleId, seriesId: s.id, role: "style" },
    });
  }
  for (const pid of opts.protagonistIds ?? []) {
    await db.assetSeriesLink.create({
      data: { assetId: pid, seriesId: s.id, role: "protagonist" },
    });
  }
  for (const sid of opts.sceneIds ?? []) {
    await db.assetSeriesLink.create({
      data: { assetId: sid, seriesId: s.id, role: "scene" },
    });
  }
  for (const mid of opts.memberIds ?? []) {
    await db.assetSeriesLink.create({
      data: { assetId: mid, seriesId: s.id, role: "member" },
    });
  }
  return s;
}

describe("series", () => {
  it("getSeriesContextForTask 返回合集上下文（主角/画风），默认不带前情；成员不算常驻主角", async () => {
    const { db } = await import("@/lib/db");
    const style = await db.asset.create({
      data: { type: "style", name: "Q版卡通", imagePathsJson: "[]" },
    });
    const p1 = await db.asset.create({
      data: {
        type: "character",
        name: "阿强",
        variantsJson: JSON.stringify([
          {
            id: "v1",
            name: "主形象",
            styleId: "",
            styleName: "",
            appearance: "保安",
            image: "data/assets/character/p1/view-01.png",
          },
        ]),
      },
    });
    const m1 = await db.asset.create({
      data: { type: "character", name: "小胖", imagePrompt: "配角", imagePathsJson: "[]" },
    });
    const s = await createSeriesWithLinks({
      name: "阿强和他的猫",
      intro: "深夜巡逻",
      styleId: style.id,
      protagonistIds: [p1.id],
      memberIds: [m1.id],
    });
    const t = await db.task.create({
      data: { sourceType: "self-made", seriesId: s.id, episodeNo: 2 },
    });
    const { getSeriesContextForTask } = await import("@/lib/series");
    const ctx = await getSeriesContextForTask(t);
    expect(ctx?.name).toBe("阿强和他的猫");
    expect(ctx?.styleAssetId).toBe(style.id);
    expect(ctx?.protagonists).toEqual([
      {
        id: p1.id,
        name: "阿强",
        imagePrompt: "保安",
        keywords: "",
        image: "data/assets/character/p1/view-01.png",
        characterProfile: "",
        personality: "",
        traits: "",
      },
    ]);
    // carryContext 默认关闭 → 不带前情
    expect(ctx?.recentEpisodes).toEqual([]);
    await db.$disconnect();
  });

  it("carryContext 开启时附最近 3 集简介（按集数升序）", async () => {
    const { db } = await import("@/lib/db");
    const style = await db.asset.create({
      data: { type: "style", name: "画风", imagePathsJson: "[]" },
    });
    const s = await createSeriesWithLinks({ name: "S", styleId: style.id });
    for (let n = 1; n <= 4; n++) {
      await db.task.create({
        data: {
          sourceType: "self-made",
          seriesId: s.id,
          episodeNo: n,
          title: `第${n}集`,
          episodeDigest: `第${n}集简介`,
        },
      });
    }
    const cur = await db.task.findFirstOrThrow({
      where: { seriesId: s.id, episodeNo: 4 },
    });
    await db.task.update({ where: { taskId: cur.taskId }, data: { carryContext: true } });
    const loaded = await db.task.findUniqueOrThrow({ where: { taskId: cur.taskId } });
    const { getSeriesContextForTask } = await import("@/lib/series");
    const ctx = await getSeriesContextForTask(loaded);
    expect(ctx?.recentEpisodes.map((e) => e.episodeNo)).toEqual([1, 2, 3]);
    expect(ctx?.recentEpisodes[2]?.digest).toBe("第3集简介");
    await db.$disconnect();
  });

  it("applySeriesLock：画风固定为合集画风，主角角色锁定，客串角色不动", async () => {
    const { db } = await import("@/lib/db");
    const style = await db.asset.create({
      data: { type: "style", name: "画风", imagePathsJson: "[]" },
    });
    const hero = await db.asset.create({
      data: { type: "character", name: "阿强", imagePathsJson: "[]" },
    });
    const guest = await db.asset.create({
      data: { type: "character", name: "胖墩", imagePathsJson: "[]" },
    });
    const s = await createSeriesWithLinks({
      name: "S",
      styleId: style.id,
      protagonistIds: [hero.id],
    });
    const { applySeriesLock } = await import("@/lib/series");
    const bindings = {
      scene: { name: "街道", assetId: null },
      characters: [
        { name: "阿强", assetId: null },
        { name: "胖墩", assetId: guest.id },
      ],
    };
    const locked = await applySeriesLock(bindings, s.id);
    expect(locked.style?.assetId).toBe(style.id);
    expect(locked.characters[0]?.assetId).toBe(hero.id);
    expect(locked.characters[1]?.assetId).toBe(guest.id);
    // 无合集任务不受影响
    const unlocked = await applySeriesLock(bindings, null);
    expect(unlocked).toBe(bindings);
    await db.$disconnect();
  });

  it("serializeSeries 含集数与主角/成员快照", async () => {
    const { db } = await import("@/lib/db");
    const style = await db.asset.create({
      data: { type: "style", name: "画风", imagePathsJson: "[]" },
    });
    const p = await db.asset.create({
      data: { type: "character", name: "阿强", imagePathsJson: "[]" },
    });
    const member = await db.asset.create({
      data: { type: "scene", name: "巷口", imagePathsJson: "[]" },
    });
    const s = await createSeriesWithLinks({
      name: "阿强和他的猫",
      styleId: style.id,
      protagonistIds: [p.id],
      memberIds: [member.id],
    });
    await db.task.create({
      data: { sourceType: "self-made", seriesId: s.id, episodeNo: 1 },
    });
    const { serializeSeries } = await import("@/lib/series");
    const out = await serializeSeries(s.id);
    expect(out.episodeCount).toBe(1);
    expect(out.styleAssetId).toBe(style.id);
    expect(out.protagonists[0]?.name).toBe("阿强");
    expect(out.memberAssetIds).toEqual([member.id]);
    expect(out.members[0]?.name).toBe("巷口");
    expect(out.status).toBe("ongoing");
    await db.$disconnect();
  });

  it("资产可跨多合集（多对多），角色记录在关联上", async () => {
    const { db } = await import("@/lib/db");
    const p = await db.asset.create({
      data: { type: "character", name: "阿强", imagePathsJson: "[]" },
    });
    const s1 = await db.series.create({ data: { name: "S1" } });
    const s2 = await db.series.create({ data: { name: "S2" } });
    const {
      replaceAssetLinks,
      getAssetSeriesLinks,
      replaceSeriesLinks,
      getSeriesAssetLinks,
      inferAssetSeriesRole,
    } = await import("@/lib/series");

    // S1 中是主角、S2 中是成员
    await replaceAssetLinks(p.id, [
      { seriesId: s1.id, role: "protagonist" },
      { seriesId: s2.id, role: "member" },
    ]);
    const links = await getAssetSeriesLinks(p.id);
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.seriesId).sort()).toEqual([s1.id, s2.id].sort());
    expect(links.find((l) => l.seriesId === s1.id)?.role).toBe("protagonist");
    expect(links.find((l) => l.seriesId === s2.id)?.role).toBe("member");

    // 角色按资产类型推断
    expect(inferAssetSeriesRole("character")).toBe("protagonist");
    expect(inferAssetSeriesRole("scene")).toBe("scene");
    expect(inferAssetSeriesRole("style")).toBe("style");

    // 合集侧整替：S2 换主角后，旧成员关联被清除
    const p2 = await db.asset.create({
      data: { type: "character", name: "阿强二号", imagePathsJson: "[]" },
    });
    await replaceSeriesLinks(s2.id, [{ assetId: p2.id, role: "protagonist" }]);
    const linked2 = await getSeriesAssetLinks(s2.id);
    expect(linked2.protagonistIds).toEqual([p2.id]);
    expect((await getAssetSeriesLinks(p.id)).map((l) => l.seriesId)).toEqual([s1.id]);
    await db.$disconnect();
  });

  it("listAssets 支持按 seriesId 过滤，并带出合集徽章信息", async () => {
    const { db } = await import("@/lib/db");
    const inSeries = await db.asset.create({
      data: { type: "character", name: "在合集角色", imagePathsJson: "[]" },
    });
    const ungrouped = await db.asset.create({
      data: { type: "character", name: "未归类角色", imagePathsJson: "[]" },
    });
    const s = await db.series.create({ data: { name: "S" } });
    await db.assetSeriesLink.create({
      data: { assetId: inSeries.id, seriesId: s.id, role: "protagonist" },
    });
    const { listAssets } = await import("@/lib/assets");
    const bySeries = await listAssets({ seriesId: s.id });
    expect(bySeries.map((a) => a.id)).toEqual([inSeries.id]);
    expect(bySeries[0]?.seriesLinks[0]?.seriesName).toBe("S");
    expect(bySeries[0]?.seriesLinks[0]?.role).toBe("protagonist");
    const all = await listAssets();
    const ids = all.map((a) => a.id);
    expect(ids).toContain(inSeries.id);
    expect(ids).toContain(ungrouped.id);
    const ug = all.find((a) => a.id === ungrouped.id);
    expect(ug?.seriesLinks).toEqual([]);
    await db.$disconnect();
  });

  it("buildSeriesPromptSection 注入主角人设字段；空字段不输出多余行", async () => {
    const { buildSeriesPromptSection } = await import("@/pipeline/prompts/series");
    const base = {
      id: "s1",
      name: "阿强和他的猫",
      intro: "",
      styleAssetId: "",
      styles: [],
      styleName: null,
      stylePreset: null,
      styleImage: null,
      protagonists: [],
      scenes: [],
      recentEpisodes: [],
    };
    // 人设字段全空：保持原有输出（无 人物设定/性格/小特点 行）
    const plain = buildSeriesPromptSection(
      {
        ...base,
        protagonists: [
          {
            id: "p1",
            name: "阿强",
            imagePrompt: "白衣短发",
            keywords: "保安, 夜班",
            image: null,
            characterProfile: "",
            personality: "",
            traits: "",
          },
        ],
      },
      3,
    );
    expect(plain).toContain("- 阿强（关键词：保安, 夜班）");
    expect(plain).not.toContain("白衣短发");
    expect(plain).not.toContain("人物设定");
    expect(plain).not.toContain("小特点");
    // 人设字段填写：按缩进行输出
    const rich = buildSeriesPromptSection(
      {
        ...base,
        protagonists: [
          {
            id: "p1",
            name: "阿强",
            imagePrompt: "保安",
            keywords: "",
            image: null,
            characterProfile: "小区夜班保安，和橘猫相依为命",
            personality: "外冷内热、嘴硬心软",
            traits: "巡逻时总叼着一根草",
          },
        ],
      },
      4,
    );
    expect(rich).toContain("人物设定：小区夜班保安，和橘猫相依为命");
    expect(rich).toContain("性格：外冷内热、嘴硬心软");
    expect(rich).toContain("小特点：巡逻时总叼着一根草");
  });
});

describe("Series 排序（拖拽持久化）", () => {
  it("reorderSeries 重写 sortOrder，列表按 sortOrder 升序", async () => {
    const { db } = await import("@/lib/db");
    const { reorderSeries } = await import("@/lib/series");
    const s1 = await db.series.create({ data: { name: "排序合集甲" } });
    const s2 = await db.series.create({ data: { name: "排序合集乙" } });
    const s3 = await db.series.create({ data: { name: "排序合集丙" } });
    await reorderSeries([s3.id, s1.id, s2.id]);
    const all = await db.series.findMany({
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      select: { id: true },
    });
    const pos = (id: string) => all.findIndex((s) => s.id === id);
    expect(pos(s3.id)).toBeLessThan(pos(s1.id));
    expect(pos(s1.id)).toBeLessThan(pos(s2.id));
    // 不存在的 id 安全忽略
    await reorderSeries(["no-such-id", s1.id, s3.id, s2.id]);
    expect((await db.series.findUnique({ where: { id: s1.id } }))!.sortOrder).toBe(0);
    await db.$disconnect();
  });
});

describe("series · 本集出场角色 / 题材类别", () => {
  it("buildSeriesPromptSection：指定 episodeCast 时注入所选角色的人设字段，替代常驻主角", async () => {
    const { buildSeriesPromptSection } = await import("@/pipeline/prompts/series");
    const base = {
      id: "s1",
      name: "S",
      intro: "深夜巡逻的世界观",
      styleAssetId: "",
      styles: [],
      styleName: null,
      stylePreset: null,
      styleImage: null,
      scenes: [],
      recentEpisodes: [],
    };
    const section = buildSeriesPromptSection(
      {
        ...base,
        protagonists: [
          {
            id: "p1",
            name: "阿强",
            imagePrompt: "保安",
            keywords: "",
            image: null,
            characterProfile: "主角设定",
            personality: "外冷内热",
            traits: "叼草",
          },
        ],
        episodeCast: [
          {
            id: "m1",
            name: "小胖",
            imagePrompt: "配角",
            keywords: "",
            image: null,
            characterProfile: "楼下小孩",
            personality: "调皮",
            traits: "爱起哄",
          },
        ],
      },
      3,
    );
    expect(section).toContain("本集出场人物");
    expect(section).toContain("- 小胖");
    expect(section).toContain("人物设定：楼下小孩");
    expect(section).toContain("性格：调皮");
    expect(section).toContain("小特点：爱起哄");
    expect(section).not.toContain("常驻主角");
    expect(section).not.toContain("- 阿强");
    expect(section).toContain("合集设定：深夜巡逻的世界观");
  });

  it("buildSeriesPromptSection：未指定 episodeCast 时回退常驻主角", async () => {
    const { buildSeriesPromptSection } = await import("@/pipeline/prompts/series");
    const section = buildSeriesPromptSection(
      {
        id: "s1",
        name: "S",
        intro: "",
        styleAssetId: "",
        styles: [],
        styleName: null,
        stylePreset: null,
        styleImage: null,
        protagonists: [
          {
            id: "p1",
            name: "阿强",
            imagePrompt: "保安",
            keywords: "",
            image: null,
            characterProfile: "",
            personality: "",
            traits: "",
          },
        ],
        scenes: [],
        recentEpisodes: [],
      },
      3,
    );
    expect(section).toContain("常驻主角");
    expect(section).toContain("- 阿强");
    expect(section).not.toContain("保安");
  });

  it("getSeriesContextForTask：castIdsJson 仅保留合集中存在的角色资产", async () => {
    const { db } = await import("@/lib/db");
    const p1 = await db.asset.create({
      data: {
        type: "character",
        name: "阿强",
        variantsJson: JSON.stringify([
          {
            id: "v1",
            name: "主形象",
            styleId: "",
            styleName: "",
            appearance: "保安",
            image: "data/assets/character/p1/view-01.png",
          },
        ]),
      },
    });
    const m1 = await db.asset.create({
      data: { type: "character", name: "小胖", imagePrompt: "配角", imagePathsJson: "[]" },
    });
    const sc = await db.asset.create({
      data: { type: "scene", name: "小区", imagePathsJson: "[]" },
    });
    const s = await createSeriesWithLinks({
      name: "S",
      protagonistIds: [p1.id],
      memberIds: [m1.id],
    });
    const t = await db.task.create({
      data: {
        sourceType: "self-made",
        seriesId: s.id,
        episodeNo: 2,
        castIdsJson: JSON.stringify([m1.id, sc.id]),
      },
    });
    const { getSeriesContextForTask } = await import("@/lib/series");
    const ctx = await getSeriesContextForTask(t);
    expect(ctx?.episodeCast?.map((c) => c.id)).toEqual([m1.id]);
    expect(ctx?.protagonists.map((p) => p.id)).toEqual([p1.id]);
    await db.$disconnect();
  });

  it("serializeSeries：SeriesTag 关联映射为 tags", async () => {
    const { db } = await import("@/lib/db");
    const t1 = await db.tag.create({ data: { name: "职场", description: "办公室场景为主" } });
    const t2 = await db.tag.create({ data: { name: "萌宠动物" } });
    const s = await db.series.create({
      data: { name: "标签合集", tags: { create: [{ tagId: t1.id }, { tagId: t2.id }] } },
    });
    const { serializeSeries } = await import("@/lib/series");
    const out = await serializeSeries(s.id);
    expect(out.tags.map((t) => t.name).sort()).toEqual(["职场", "萌宠动物"]);
    expect(out.tags.find((t) => t.id === t1.id)?.description).toBe("办公室场景为主");
    await db.$disconnect();
  });
});
