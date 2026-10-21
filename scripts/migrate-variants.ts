#!/usr/bin/env tsx
/**
 * 一次性迁移脚本：旧资产模型 → 形象变体（variants）模型
 *
 * 用法：
 *   npx tsx scripts/migrate-variants.ts          # 迁移 data/comics.db
 *   npx tsx scripts/migrate-variants.ts --style 古风仙侠   # 指定目标画风资产名
 *   npx tsx scripts/migrate-variants.ts --retag        # 已迁移资产：把现有变体画风统一改为目标画风
 *   npx tsx scripts/migrate-variants.ts --backfill     # 已迁移资产：主形象外观设定为空时用旧 imagePrompt 回填
 *
 * 迁移内容（角色/场景资产）：
 *   1. 基础参考图 imagePaths[0] → 变体「主形象」（画风 = Q版仙侠，外观设定 = 原 imagePrompt）
 *   2. 装扮变体 outfits        → 变体（形象名 = 装扮名，画风 = Q版仙侠，外观设定 = 原 imagePrompt）
 *   3. 已有画风变体 styleVariants → 变体（保留其各自画风与外观设定）
 *
 * 图片文件不移动，仅建立引用；脚本幂等（variantsJson 非空的资产跳过）。
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";
import type { SqlDriverAdapterFactory } from "@prisma/driver-adapter-utils";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

function resolveDbFile(): string {
  const raw = (process.env.DB_FILE ?? "").trim();
  const value = raw || "./data/comics.db";
  return value.startsWith("file:") ? value : `file:${value}`;
}

const dbFile = resolveDbFile();
if (!dbFile.includes("comics.db")) {
  console.error(`安全校验：目标库必须为 comics.db，当前为 ${dbFile}，已中止。`);
  process.exit(1);
}

const adapter: SqlDriverAdapterFactory = new PrismaLibSql({ url: dbFile });
const db = new PrismaClient({ adapter });

type Variant = {
  id: string;
  name: string;
  styleId: string;
  styleName: string;
  appearance: string;
  image: string;
};

function parseArr(json: unknown): any[] {
  if (typeof json !== "string" || !json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let styleNameHint = "Q版仙侠";
  const i = args.indexOf("--style");
  if (i >= 0 && args[i + 1]) styleNameHint = args[i + 1];
  const retag = args.includes("--retag");
  const backfill = args.includes("--backfill");
  const norm = (name: string) => name.replace(/\s+/g, "");

  const styles = await db.asset.findMany({ where: { type: "style" } });
  const target =
    styles.find((s) => norm(s.name) === norm(styleNameHint)) ??
    styles.find((s) => norm(s.name).includes("Q版仙侠")) ??
    styles.find((s) => norm(s.name).includes("仙侠")) ??
    styles.find((s) => norm(s.name).includes("Q版"));
  if (!target) {
    console.error(`未找到「${styleNameHint}」画风资产。现有画风资产：`);
    for (const s of styles) console.error(`  - ${s.name} (${s.id})`);
    process.exit(1);
  }
  console.log(`目标画风资产：${target.name} (${target.id})`);

  const assets = await db.asset.findMany({
    where: { type: { in: ["character", "scene"] } },
  });
  let migrated = 0;
  let skipped = 0;
  let retagged = 0;
  let backfilled = 0;
  for (const a of assets) {
    const oldVariants = parseArr(a.styleVariantsJson);
    const outfits = parseArr(a.outfitsJson);
    const imagePaths = parseArr(a.imagePathsJson).filter((p) => typeof p === "string");
    const existing = parseArr(a.variantsJson);
    if (existing.length > 0) {
      let touched = false;
      if (retag) {
        // 已迁移资产：把现有变体的画风统一改为目标画风（只改 styleId/styleName，不动图片与外观设定）
        const next = existing.map((v) =>
          v && typeof v === "object" && (v.styleId !== target.id || v.styleName !== target.name)
            ? { ...v, styleId: target.id, styleName: target.name }
            : v,
        );
        const changed = JSON.stringify(next) !== JSON.stringify(existing);
        if (changed) {
          await db.asset.update({
            where: { id: a.id },
            data: { variantsJson: JSON.stringify(next) },
          });
          retagged += 1;
          console.log(`  ↻ ${a.name}：${next.length} 个变体画风改为「${target.name}」`);
          touched = true;
        }
      }
      if (backfill) {
        // 已迁移资产：主形象外观设定为空且旧 imagePrompt 有值 → 用旧提示词回填
        const prompt = typeof a.imagePrompt === "string" ? a.imagePrompt.trim() : "";
        const v0 = existing[0] as Record<string, unknown> | undefined;
        const v0Appearance =
          v0 && typeof v0.appearance === "string" ? (v0.appearance as string).trim() : "";
        if (!touched && prompt && v0 && !v0Appearance) {
          const next = existing.map((v, i) => (i === 0 ? { ...v, appearance: prompt } : v));
          await db.asset.update({
            where: { id: a.id },
            data: { variantsJson: JSON.stringify(next) },
          });
          backfilled += 1;
          console.log(`  ↻ ${a.name}：主形象外观设定回填（旧 imagePrompt）`);
          touched = true;
        }
      }
      if (!touched) skipped += 1;
      continue;
    }
    const variants: Variant[] = [];
    const push = (
      name: string,
      styleId: string,
      styleName: string,
      appearance: string,
      image: string,
    ) => {
      variants.push({ id: randomUUID(), name, styleId, styleName, appearance, image });
    };
    // 1. 主形象
    if (imagePaths[0]) {
      push("主形象", target.id, target.name, a.imagePrompt ?? "", imagePaths[0]);
    }
    // 2. 装扮变体 → Q版仙侠 变体
    for (const o of outfits) {
      if (o && typeof o.name === "string" && typeof o.image === "string") {
        push(o.name, target.id, target.name, a.imagePrompt ?? "", o.image);
      }
    }
    // 3. 已有画风变体 → 保留各自画风
    for (const v of oldVariants) {
      if (!v || typeof v.styleId !== "string" || typeof v.image !== "string") continue;
      const appearance =
        typeof v.appearance === "string" && v.appearance ? v.appearance : (a.imagePrompt ?? "");
      if (variants.some((x) => x.styleId === v.styleId && x.appearance === appearance)) continue;
      const nm = typeof v.styleName === "string" && v.styleName ? `${v.styleName}形象` : "画风变体";
      push(nm, v.styleId, typeof v.styleName === "string" ? v.styleName : "", appearance, v.image);
    }
    if (variants.length === 0) {
      skipped += 1;
      console.log(`  - 跳过「${a.name}」：无参考图`);
      continue;
    }
    await db.asset.update({
      where: { id: a.id },
      data: { variantsJson: JSON.stringify(variants) },
    });
    migrated += 1;
    console.log(
      `  ✓ ${a.name} (${a.type})：${variants.length} 个变体 [${variants.map((v) => v.name).join("、")}]`,
    );
  }
  console.log(
    `\n迁移完成：${migrated} 个资产已迁移，${retagged} 个已重标画风，${backfilled} 个已回填外观设定，${skipped} 个跳过。`,
  );
  console.log("注意：imagePrompt / outfitsJson / styleVariantsJson 列尚未删除，");
  console.log("确认数据无误后，再从 prisma/schema.prisma 删除旧列并执行 db push。");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
