#!/usr/bin/env tsx
/**
 * 预设数据填充：把内容标签库的初始标签（含说明书）写入 Tag 表。
 *
 * 用法：
 *   pnpm db:seed
 *   npx tsx scripts/db-seed.ts
 *   DB_FILE=./data/other.db pnpm db:seed   # 灌到指定库
 *
 * 幂等：同名标签一律跳过，不会覆盖用户自己改过的说明书，可以反复执行。
 * 只写这类无关紧要的预设数据——不生成图片、不建合集/主体/任务，
 * 也不碰 AppSetting（那里面是模型端点与密钥，属于用户自己的配置）。
 */
import { db } from "@/lib/db";
import { missingPresetTags, PRESET_TAGS } from "@/lib/preset-tags";

// loadEnvFile 不会覆盖已存在的变量，测试/CLI 注入的值优先
try {
  process.loadEnvFile();
} catch {
  // 无 .env 时回落系统环境变量
}

async function main() {
  const existing = await db.tag.findMany({ select: { name: true } });
  const missing = missingPresetTags(existing.map((tag) => tag.name));

  if (missing.length === 0) {
    console.log(
      `预设标签已全部存在，未写入任何数据（标签库现有 ${existing.length} 个，本次跳过 ${PRESET_TAGS.length} 个同名标签）。`,
    );
    return;
  }

  for (const tag of missing) {
    await db.tag.create({ data: { name: tag.name, description: tag.description } });
    console.log(`+ ${tag.name}`);
  }

  const skipped = PRESET_TAGS.length - missing.length;
  console.log(
    `已填充 ${missing.length} 个预设标签${skipped ? `，跳过 ${skipped} 个同名标签` : ""}；` +
      `标签库现有 ${existing.length + missing.length} 个，可在 /tags 页继续增删改。`,
  );
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (err) => {
    console.error("填充失败：", err instanceof Error ? err.message : err);
    await db.$disconnect().catch(() => {});
    process.exit(1);
  });
