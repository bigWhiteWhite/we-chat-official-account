#!/usr/bin/env tsx
/**
 * imageApi 生图模型可用性检测脚本。
 *
 * 用法：
 *   npx tsx scripts/check-image-models.ts
 *   npm run check:image
 *
 * 常用参数：
 *   --generate / -g       执行一次最小真实生图请求（默认只做网关连通/鉴权探测，不产生生图费用）
 *   --timeout-ms <ms>     超时时间；默认探测 15s，真实生图 120s
 *   --prompt <text>       真实生图 prompt
 *   --only <model>        只检测指定模型：写全 域/modelId 时直接探测该模型，
 *                         裸 modelId 则要求它正是已配置的主模型
 *   --limit <n>           只检测前 n 个
 *   --json                输出 JSON
 *
 * 默认检测对象即 imageApi 域主模型 MODEL_IMAGE_API_PRIMARY（含 /settings 页覆盖），
 * 未配置时直接报错提示。
 * 请求协议与 src/pipeline/artist.ts 一致：按 imageApi 域的「生图协议」选择
 * POST {baseUrl}/images/generations（openai）或 POST {baseUrl}/wand/si-image/generation（si-image）。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { ensureSettingsLoaded } from "../src/lib/settings-store";
import { getModelChain } from "../src/model-manager/registry";
import { resolveModelRef } from "../src/model-manager/resolve";
import { getGatewayHttpConfig } from "../src/model-manager/providers/http";
import type { ImageProtocol } from "../src/model-manager/types";

type Args = {
  generate: boolean;
  timeoutMs: number | null;
  prompt: string;
  json: boolean;
  only: string | null;
  limit: number | null;
};

type ProbeResult = {
  id: string;
  gateway: string;
  modelId: string;
  baseUrl: string;
  status: "ok" | "fail" | "skipped" | "error";
  generated: boolean;
  latencyMs: number;
  detail: string;
};

function printUsage(): void {
  console.log(`imageApi 生图模型可用性检测

用法:
  npx tsx scripts/check-image-models.ts [options]

选项:
  -g, --generate        执行最小真实生图请求（默认关闭，避免消耗配额）
      --timeout-ms <n>  超时毫秒数；默认探测 15000，真实生图 120000
      --prompt <text>   真实生图 prompt
      --only <model>    只检测指定模型：域/modelId 直接探测，裸 modelId 需为已配置主模型
      --limit <n>       只检测前 n 个
      --json            输出 JSON
  -h, --help            显示帮助
`);
}

function requireNextArg(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined) {
    throw new Error(`参数 ${flag} 需要一个值`);
  }
  return value;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    generate: false,
    timeoutMs: null,
    prompt: "一只白色小猫，纯色背景，用于连通性测试",
    json: false,
    only: null,
    limit: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-g" || arg === "--generate") {
      args.generate = true;
    } else if (arg === "--timeout-ms") {
      const raw = requireNextArg(argv, i, "--timeout-ms");
      args.timeoutMs = Number(raw);
      i += 1;
    } else if (arg.startsWith("--timeout-ms=")) {
      args.timeoutMs = Number(arg.split("=").slice(1).join("="));
    } else if (arg === "--prompt") {
      args.prompt = requireNextArg(argv, i, "--prompt");
      i += 1;
    } else if (arg.startsWith("--prompt=")) {
      args.prompt = arg.split("=").slice(1).join("=");
    } else if (arg === "--only") {
      args.only = requireNextArg(argv, i, "--only");
      i += 1;
    } else if (arg.startsWith("--only=")) {
      args.only = arg.split("=").slice(1).join("=");
    } else if (arg === "--limit") {
      const raw = requireNextArg(argv, i, "--limit");
      args.limit = Number(raw);
      i += 1;
    } else if (arg.startsWith("--limit=")) {
      args.limit = Number(arg.split("=").slice(1).join("="));
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }

  if (args.timeoutMs !== null && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) {
    throw new Error("--timeout-ms 必须是正整数");
  }
  if (args.limit !== null && (!Number.isInteger(args.limit) || args.limit <= 0)) {
    throw new Error("--limit 必须是正整数");
  }
  return args;
}

function loadDotEnvFile(file: string, originalEnv: NodeJS.ProcessEnv): void {
  const filePath = path.resolve(process.cwd(), file);
  if (!existsSync(filePath)) return;

  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    let key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (key.startsWith("export ")) key = key.slice("export ".length).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && originalEnv[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError" || /abort|timeout|timed out/i.test(err.message)) {
      return "请求超时或被中止";
    }
    return err.message;
  }
  return String(err);
}

/** 域/modelId 形式且端点可解析时，--only 直接作为探测目标 */
function isDirectRef(id: string): boolean {
  if (!id.includes("/")) return false;
  try {
    resolveModelRef(id);
    return true;
  } catch {
    return false;
  }
}

async function probeGatewayReach(
  baseUrl: string,
  apiKey: string,
  timeoutMs: number,
): Promise<{ ok: boolean; detail: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    const ok = res.ok || res.status === 404;
    const body = ok ? "" : await res.text().catch(() => "");
    return {
      ok,
      detail: ok
        ? `HTTP ${res.status}`
        : `HTTP ${res.status}${body ? `: ${body.slice(0, 180)}` : ""}`,
    };
  } catch (err) {
    return { ok: false, detail: errorMessage(err) };
  } finally {
    clearTimeout(timer);
  }
}

type ImageGenerationResponse = {
  data?: Array<{ b64_json?: string; url?: string }>;
};

async function generateTestImage(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  prompt: string,
  timeoutMs: number,
  protocol: ImageProtocol = "openai",
): Promise<{ imageKind: string }> {
  const siImage = protocol === "si-image";
  const body: Record<string, unknown> = {
    model: modelId,
    prompt,
    size: "1024x1024",
  };
  if (!siImage) {
    body.response_format = "b64_json";
    body.n = 1;
    if (/gpt-image/i.test(modelId)) {
      body.quality = "low";
    }
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      `${baseUrl}${siImage ? "/wand/si-image/generation" : "/images/generations"}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 240)}` : ""}`);
    }
    const json = (await res.json()) as ImageGenerationResponse;
    const item = json.data?.[0];
    if (item?.b64_json) return { imageKind: "b64_json" };
    if (item?.url) return { imageKind: "url" };
    throw new Error("响应中没有 b64_json 或 url");
  } catch (err) {
    throw new Error(errorMessage(err));
  } finally {
    clearTimeout(timer);
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T, index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()),
  );
  return results;
}

async function checkModel(modelRef: string, args: Args, timeoutMs: number): Promise<ProbeResult> {
  const startedAt = Date.now();
  const base = {
    id: modelRef,
    gateway: "unknown",
    modelId: "unknown",
    baseUrl: "",
    generated: false,
  };

  let ref;
  try {
    ref = resolveModelRef(modelRef);
  } catch (err) {
    return {
      ...base,
      status: "error",
      latencyMs: Date.now() - startedAt,
      detail: errorMessage(err),
    };
  }

  const withRef = { ...base, gateway: ref.gateway, modelId: ref.modelId };
  const http = getGatewayHttpConfig(ref.gateway);
  if (!http) {
    return {
      ...withRef,
      status: "skipped",
      latencyMs: Date.now() - startedAt,
      detail: "未配置 API Key 或网关不可用",
    };
  }

  const baseUrl = http.baseUrl;
  const reach = await probeGatewayReach(baseUrl, http.apiKey, Math.min(timeoutMs, 10_000));
  if (!reach.ok) {
    return {
      ...withRef,
      baseUrl,
      status: "fail",
      latencyMs: Date.now() - startedAt,
      detail: `网关探测失败: ${reach.detail}`,
    };
  }

  if (!args.generate) {
    return {
      ...withRef,
      baseUrl,
      status: "ok",
      latencyMs: Date.now() - startedAt,
      detail: `网关可达（${reach.detail}）；未执行真实生图`,
    };
  }

  try {
    const generated = await generateTestImage(
      baseUrl,
      http.apiKey,
      ref.modelId,
      args.prompt,
      timeoutMs,
      http.imageProtocol,
    );
    return {
      ...withRef,
      baseUrl,
      status: "ok",
      generated: true,
      latencyMs: Date.now() - startedAt,
      detail: `真实生图成功，返回 ${generated.imageKind}`,
    };
  } catch (err) {
    return {
      ...withRef,
      baseUrl,
      status: "fail",
      latencyMs: Date.now() - startedAt,
      detail: `真实生图失败: ${errorMessage(err)}`,
    };
  }
}

function printTable(results: ProbeResult[], args: Args): void {
  console.log("imageApi 生图模型可用性检测");
  console.log(
    `模式: ${args.generate ? "真实生图" : "仅网关连通/鉴权"}；检测对象为 imageApi 域主模型`,
  );
  console.log("");

  for (const r of results) {
    const icon = r.status === "ok" ? "OK  " : r.status === "skipped" ? "SKIP" : "FAIL";
    const latency = r.latencyMs === 0 ? "-" : `${r.latencyMs}ms`;
    console.log(`[${icon}] ${r.id}`);
    console.log(`         gateway=${r.gateway} baseUrl=${r.baseUrl || "-"} latency=${latency}`);
    console.log(`         ${r.detail}`);
  }

  const ok = results.filter((r) => r.status === "ok").length;
  console.log("");
  console.log(`结果: ${ok}/${results.length} 可用`);
  if (!args.generate && ok > 0) {
    console.log("提示: 当前未验证真实出图，可加 --generate 做最小真实生图检测。");
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const originalEnv = { ...process.env };
  loadDotEnvFile(".env", originalEnv);
  loadDotEnvFile(".env.local", originalEnv);
  // 独立脚本不走 Next 启动钩子，须显式加载 AppSetting 覆盖层才能读到 /settings 页的配置
  await ensureSettingsLoaded();

  const timeoutMs = args.timeoutMs ?? (args.generate ? 120_000 : 15_000);
  const direct = args.only && isDirectRef(args.only) ? [args.only] : null;
  let ordered = direct ?? getModelChain("imageApi");

  if (args.only && !direct) {
    ordered = ordered.filter((id) => {
      try {
        return resolveModelRef(id).modelId === args.only;
      } catch {
        return false;
      }
    });
  }
  if (args.limit !== null) {
    ordered = ordered.slice(0, args.limit);
  }

  if (ordered.length === 0) {
    throw new Error(
      `没有可检测的 imageApi 模型：--only=${args.only} 不是当前配置的主模型（写全 域/modelId 可直接探测该域端点上的任意模型）`,
    );
  }

  const results = await runWithConcurrency(ordered, 2, (id) => checkModel(id, args, timeoutMs));

  if (args.json) {
    console.log(JSON.stringify({ args, results }, null, 2));
  } else {
    printTable(results, args);
  }

  const okCount = results.filter(
    (r) => r.status === "ok" && (!args.generate || r.generated),
  ).length;
  process.exitCode = okCount > 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
