#!/usr/bin/env tsx
/**
 * 标签库说明书补齐脚本：一次 mainLight 批量调用，为标签生成「说明书」式 description 并写回。
 *
 * 用法：
 *   npx tsx scripts/fill-tag-descriptions.ts            # 只补缺失（description 为空）的标签
 *   npx tsx scripts/fill-tag-descriptions.ts --dry-run  # 只打印，不写库
 *   npx tsx scripts/fill-tag-descriptions.ts --force    # 已有说明的也重写
 *   npx tsx scripts/fill-tag-descriptions.ts --only 职场,萌宠
 *
 * 标签说明会注入 buildTopicPrompt / buildCreatePrompt（见 prompts/tags.ts），
 * 所以文案写成给 LLM 的创作要求，而不是给人看的定义。
 */
import { db } from "@/lib/db";
import { ensureSettingsLoaded } from "@/lib/settings-store";
import { chatCompletionForBiz } from "@/model-manager";

import { parseTolerantJson } from "../src/pipeline/topic";

// loadEnvFile 不会覆盖已存在的变量，测试/CLI 注入的值优先
try {
  process.loadEnvFile();
} catch {
  // 无 .env 时回落系统环境变量
}

type Args = {
  dryRun: boolean;
  force: boolean;
  only: string[] | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, force: false, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--force") {
      args.force = true;
    } else if (arg === "--only" || arg.startsWith("--only=")) {
      let raw: string;
      if (arg.startsWith("--only=")) {
        raw = arg.slice("--only=".length);
      } else {
        i += 1;
        raw = argv[i] ?? "";
      }
      const list = String(raw)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length === 0) throw new Error("--only 需要一个逗号分隔的标签名列表");
      args.only = list;
    } else if (arg === "-h" || arg === "--help") {
      console.log(
        "用法: npx tsx scripts/fill-tag-descriptions.ts [--dry-run] [--force] [--only 名1,名2]",
      );
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  return args;
}

function buildPrompt(names: string[]): string {
  return [
    "下面是公众号 AI 漫画系统的「内容标签」列表。每个标签会被选中并注入 AI 选题与剧本创作的提示词，",
    "标签说明就是必须遵守的创作要求，请为每个标签写一段创作说明书（不是给人看的定义）。",
    "",
    "第一步先判断该标签的题材基调：搞笑向 / 非搞笑向（治愈、情感、悬疑、科普、现实、历史、仙侠等）/ 两者皆可。",
    "基调由标签本身决定，严禁假设所有标签都要好笑：",
    "- 只有搞笑向才写笑点与包袱机制；",
    "- 非搞笑向不得出现「笑点」「玩梗」「怎么好笑」这类措辞，改写该题材自身的情绪机制与叙事张力（悬念、共鸣、燃点、泪点、知识惊喜等）；",
    "- 两者皆可的要写明主次，以及轻松与深情之间怎么取舍。",
    "",
    "每个标签的说明须覆盖：",
    "1. 选题范围与常见场景（写什么内容、发生在哪）",
    "2. 基调与情绪机制（靠什么打动读者：笑点 / 共鸣 / 悬念 / 治愈 / 认知惊喜等，须与上一步判定的基调一致）",
    "3. 典型角色设定（谁来演）",
    "4. 一条边界或避免项（不要写成什么样）",
    "",
    "硬性要求：",
    "- 每条不超过 90 个字，单行，不加引号、不换行、不带列表符号",
    "- 相近标签（如「职场」与「打工人」）写法必须错开，保证选题方向可区分",
    "- JSON 的 key 必须与给定标签名逐字一致，一个都不能少",
    "",
    '只输出 JSON，格式：{"descriptions": {"标签名": "说明"}}',
    "",
    "标签列表：",
    ...names.map((n) => `- ${n}`),
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const all = await db.tag.findMany({ orderBy: { createdAt: "asc" } });
  let targets = args.only
    ? all.filter((t) => args.only!.includes(t.name))
    : all.filter((t) => args.force || !t.description.trim());

  const missing = args.only ? args.only.filter((n) => !all.some((t) => t.name === n)) : [];
  if (missing.length > 0) {
    console.error(`以下标签名不存在：${missing.join("、")}`);
    process.exit(1);
  }
  if (targets.length === 0) {
    console.log("没有需要补齐的标签（全部已有说明）。可用 --force 重写。");
    await db.$disconnect();
    return;
  }

  console.log(`待处理 ${targets.length} 个标签：${targets.map((t) => t.name).join("、")}`);

  // 主模型 / apiKey 走 envOrSetting：必须先加载 AppSetting 覆盖层，否则 /settings 页存的配置读不到
  await ensureSettingsLoaded();

  const map = await generateInChunks(targets);

  let updated = 0;
  const skipped: string[] = [];
  for (const tag of targets) {
    const value = map.get(tag.name);
    const text = (value ?? "").trim().slice(0, 200);
    if (!text) {
      skipped.push(tag.name);
      continue;
    }
    if (args.dryRun) {
      console.log(`[dry-run] ${tag.name} → ${text}`);
    } else {
      await db.tag.update({ where: { id: tag.id }, data: { description: text } });
    }
    updated += 1;
  }

  console.log(
    `${args.dryRun ? "预览" : "已写入"} ${updated} 条说明${skipped.length ? `；LLM 未返回：${skipped.join("、")}` : ""}`,
  );
  await db.$disconnect();
}

/** 一次问太多标签会让模型输出超长返回空 payload，按 CHUNK_SIZE 分批，每批失败重试若干次 */
const CHUNK_SIZE = 6;
const CHUNK_RETRIES = 3;

async function generateInChunks(targets: { name: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
    const chunk = targets.slice(i, i + CHUNK_SIZE);
    const names = chunk.map((t) => t.name);
    console.log(`批次 ${i / CHUNK_SIZE + 1}：${names.join("、")}`);

    let lastErr: unknown;
    for (let attempt = 1; attempt <= CHUNK_RETRIES; attempt += 1) {
      try {
        const raw = await chatCompletionForBiz(
          "mainLight",
          [
            { role: "system", content: "你是漫画内容生产系统的标签管理员，只输出 JSON。" },
            { role: "user", content: buildPrompt(names) },
          ],
          { responseFormat: { type: "json_object" }, temperature: 0.5 },
        );
        const parsed = parseTolerantJson<{ descriptions?: Record<string, unknown> }>(raw);
        for (const [name, value] of Object.entries(parsed.descriptions ?? {})) {
          const text = typeof value === "string" ? value.trim() : "";
          if (text && names.includes(name) && !out.has(name)) out.set(name, text);
        }
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`  第 ${attempt} 次失败：${err instanceof Error ? err.message : err}`);
      }
    }
    const missing = names.filter((n) => !out.has(n));
    if (lastErr && missing.length === names.length) {
      throw new Error(
        `批次「${names.join("、")}」重试 ${CHUNK_RETRIES} 次仍失败：${lastErr instanceof Error ? lastErr.message : lastErr}`,
      );
    }
    if (missing.length > 0) {
      console.warn(`  本批仍缺：${missing.join("、")}`);
    }
  }
  return out;
}

main().catch(async (err) => {
  console.error("脚本失败：", err instanceof Error ? err.message : err);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
