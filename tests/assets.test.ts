import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTempDb, type TempDb } from "./helpers/test-db";

let tdb: TempDb;

beforeAll(() => {
  tdb = setupTempDb();
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
}, 30_000);

describe("Asset schema", () => {
  it("Asset create defaults and usageCount increment", async () => {
    const { db } = await import("@/lib/db");
    const a = await db.asset.create({ data: { type: "character", name: "杨过" } });
    expect(a.variantsJson).toBe("[]");
    expect(a.keywords).toBe("");
    expect(a.imagePathsJson).toBe("[]");
    expect(a.stylePreset).toBeNull();
    expect(a.usageCount).toBe(0);
    const touched = await db.asset.update({
      where: { id: a.id },
      data: { usageCount: { increment: 1 } },
    });
    expect(touched.usageCount).toBe(1);
    await db.$disconnect();
  });

  it("Task.subjectBindingsJson round-trips", async () => {
    const { db } = await import("@/lib/db");
    const task = await db.task.create({ data: { sourceType: "self-made" } });
    await db.task.update({
      where: { taskId: task.taskId },
      data: { subjectBindingsJson: '{"characters":[]}' },
    });
    const found = await db.task.findUnique({ where: { taskId: task.taskId } });
    expect(found?.subjectBindingsJson).toBe('{"characters":[]}');
    await db.$disconnect();
  });
});

describe("assets service", () => {
  it("createAsset with firstVariant copies image; list/update/delete work", async () => {
    const { db } = await import("@/lib/db");
    const { createAsset, deleteAsset, getAsset, listAssets, updateAsset } =
      await import("@/lib/assets");
    const tmp = mkdtempSync(path.join(tmpdir(), "asset-src-"));
    const src = path.join(tmp, "src.png");
    writeFileSync(src, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    try {
      const created = await createAsset({
        type: "character",
        name: "小龙女",
        keywords: "小龙女, 白发",
        firstVariant: { name: "主形象", appearance: "白发红衣", imagePath: src },
      });
      expect(created.variants).toHaveLength(1);
      expect(created.primaryImage).toMatch(/assets[\\/]character[\\/]/);
      expect(existsSync(path.resolve(created.primaryImage!))).toBe(true);
      const listed = await listAssets({ type: "character", q: "小龙" });
      expect(listed.map((a) => a.id)).toContain(created.id);
      const updated = await updateAsset(created.id, { keywords: "小龙女, 古墓" });
      expect(updated.keywords).toBe("小龙女, 古墓");
      const deleted = await deleteAsset(created.id);
      expect(deleted).toBe(true);
      expect(await getAsset(created.id)).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    await db.$disconnect();
  });

  it("character 设定字段（人物设定/性格/专属小特点）create/update round-trip", async () => {
    const { db } = await import("@/lib/db");
    const { createAsset, deleteAsset, getAsset, updateAsset } = await import("@/lib/assets");
    const created = await createAsset({
      type: "character",
      name: "阿强",
      characterProfile: "小区夜班保安，离异，和橘猫相依为命",
      personality: "外冷内热、嘴硬心软",
      traits: "巡逻时总叼着一根草",
    });
    const loaded = (await getAsset(created.id))!;
    expect(loaded.characterProfile).toBe("小区夜班保安，离异，和橘猫相依为命");
    expect(loaded.personality).toBe("外冷内热、嘴硬心软");
    expect(loaded.traits).toBe("巡逻时总叼着一根草");
    const updated = await updateAsset(created.id, { personality: "改过的外冷内热", traits: "" });
    expect(updated.personality).toBe("改过的外冷内热");
    expect(updated.traits).toBe("");
    expect(updated.characterProfile).toBe("小区夜班保安，离异，和橘猫相依为命");
    expect(await deleteAsset(created.id)).toBe(true);
    await db.$disconnect();
  });

  it("style base64 sample + replacePrimaryImage + removeAssetImages work", async () => {
    const { db } = await import("@/lib/db");
    const { createAsset, deleteAsset, imageExtForMime, removeAssetImages, replacePrimaryImage } =
      await import("@/lib/assets");

    expect(imageExtForMime("image/jpeg")).toBe(".jpg");
    expect(imageExtForMime(undefined)).toBe(".png");

    const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const jpgB64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64");

    const created = await createAsset({
      type: "style",
      name: "Q版仙侠",
      imageBase64: pngB64,
      mimeType: "image/png",
    });
    expect(created.imagePaths).toHaveLength(1);
    expect(created.imagePaths[0].endsWith(".png")).toBe(true);
    expect(existsSync(path.resolve(created.imagePaths[0]))).toBe(true);

    const replaced = await replacePrimaryImage(created.id, jpgB64, "image/jpeg");
    expect(replaced.imagePaths).toHaveLength(1);
    expect(replaced.imagePaths[0].endsWith(".jpg")).toBe(true);
    expect(existsSync(path.resolve(replaced.imagePaths[0]))).toBe(true);
    expect(existsSync(path.resolve(created.imagePaths[0]))).toBe(false);

    const cleared = await removeAssetImages(created.id);
    expect(cleared.imagePaths).toHaveLength(0);
    expect(existsSync(path.resolve(replaced.imagePaths[0]))).toBe(false);

    expect(await deleteAsset(created.id)).toBe(true);
    await db.$disconnect();
  });

  it("add/update/setPrimary/delete asset variants", async () => {
    const { db } = await import("@/lib/db");
    const {
      addAssetVariant,
      createAsset,
      deleteAsset,
      deleteAssetVariant,
      setPrimaryVariant,
      updateAssetVariant,
    } = await import("@/lib/assets");
    const tmp = mkdtempSync(path.join(tmpdir(), "asset-variant-"));
    const imgA = path.join(tmp, "a.png");
    const imgB = path.join(tmp, "b.png");
    writeFileSync(imgA, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(imgB, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    try {
      const created = await createAsset({
        type: "character",
        name: "变体测试",
        firstVariant: { name: "主形象", appearance: "白衣", imagePath: imgA },
      });
      expect(created.variants).toHaveLength(1);
      const primaryId = created.variants[0].id;

      const added = await addAssetVariant(created.id, {
        name: "职场西装",
        styleId: "s1",
        styleName: "Q版仙侠",
        appearance: "西装",
        image: imgB,
      });
      expect(added.variants).toHaveLength(2);
      const v2 = added.variants[1];
      expect(v2.name).toBe("职场西装");
      expect(v2.styleId).toBe("s1");

      const patched = await updateAssetVariant(created.id, v2.id, { appearance: "深灰西装" });
      expect(patched.variants[1].appearance).toBe("深灰西装");
      expect(patched.variants[1].image).toBe(imgB);

      const promoted = await setPrimaryVariant(created.id, v2.id);
      expect(promoted.variants[0].id).toBe(v2.id);
      expect(promoted.primaryImage).toBe(imgB);

      const removed = await deleteAssetVariant(created.id, v2.id);
      expect(removed.variants).toHaveLength(1);
      expect(removed.variants[0].id).toBe(primaryId);

      expect(await deleteAsset(created.id)).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    await db.$disconnect();
  });
});

describe("Asset 排序（拖拽持久化）", () => {
  it("reorderAssets 重写 sortOrder，listAssets 按 sortOrder 升序", async () => {
    const { db } = await import("@/lib/db");
    const { createAsset, listAssets, reorderAssets } = await import("@/lib/assets");
    const a1 = await createAsset({ type: "character", name: "排序甲" });
    const a2 = await createAsset({ type: "character", name: "排序乙" });
    const a3 = await createAsset({ type: "character", name: "排序丙" });
    await reorderAssets([a3.id, a1.id, a2.id]);
    const listed = await listAssets({ type: "character" });
    const idx = (id: string) => listed.findIndex((a) => a.id === id);
    expect(idx(a3.id)).toBeLessThan(idx(a1.id));
    expect(idx(a1.id)).toBeLessThan(idx(a2.id));
    // 不存在的 id 安全忽略，顺序号按出现位置重写
    await reorderAssets([a2.id, "no-such-id", a1.id]);
    expect((await db.asset.findUnique({ where: { id: a1.id } }))!.sortOrder).toBe(1);
    expect((await db.asset.findUnique({ where: { id: a2.id } }))!.sortOrder).toBe(0);
    await db.$disconnect();
  });
});
