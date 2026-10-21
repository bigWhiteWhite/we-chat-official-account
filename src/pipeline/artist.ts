import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import pLimit from "p-limit";
import pRetry from "p-retry";

import {
  getImageGenConcurrency,
  getNarrationInImage,
  getStylePreset,
} from "@/lib/business-settings";
import { endpointEnvHint, getGatewayHttpConfig, withModelFallback } from "@/model-manager";
import type { GatewayHttpConfig } from "@/model-manager";

import { uniqueCast, type ComicScript } from "./schema";
import { nextPanelPath } from "./panel-versions";
import { buildPanelPrompt } from "./prompts/panel";
import {
  buildCharacterViewPrompt,
  buildSceneViewPrompt,
  buildStylePreviewPrompt,
} from "./prompts/subjects";
import type { TaskReferences } from "./subjects";

const IMAGE_GEN_TIMEOUT_MS = 300_000;

export type GeneratedImage = { path: string; width: number; height: number };

export async function callImageApi(
  prompt: string,
  outPath: string,
  size?: string,
): Promise<GeneratedImage> {
  return withModelFallback("imageApi", async ({ ref }) => {
    console.log(`[artist] 文生图调用：model=${ref.modelId} gateway=${ref.gateway} out=${outPath}`);
    const http = getGatewayHttpConfig(ref.gateway);
    if (!http) {
      throw new Error(
        `${ref.gateway} 域未配置端点：请在 /settings 页或 .env 填写 ${endpointEnvHint(ref.gateway)}（模型 ${ref.modelId}）`,
      );
    }
    if (http.imageProtocol === "si-image") {
      return callSiImageGeneration(http, ref.modelId, prompt, outPath, { size });
    }
    const res = await fetch(`${http.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${http.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ref.modelId,
        prompt,
        size: size ?? "1024x1024",
        response_format: "b64_json",
      }),
      signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`image api HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const item = json.data?.[0];
    const buf = item?.b64_json
      ? Buffer.from(item.b64_json, "base64")
      : item?.url
        ? Buffer.from(await (await fetch(item.url)).arrayBuffer())
        : (() => {
            throw new Error("image api 无返回图片");
          })();
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, buf);
    return { path: outPath, width: 1024, height: 1024 };
  });
}

function withTimeout(external: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  if (!external) return AbortSignal.timeout(timeoutMs);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), timeoutMs);
  if (external.aborted) ctrl.abort();
  else external.addEventListener("abort", () => ctrl.abort(), { once: true });
  return ctrl.signal;
}

/** si-image 协议一次最多接收的参考图数量，超出部分丢弃 */
const SI_IMAGE_MAX_REFS = 10;

/**
 * TokenHub / 混元私有生图协议：POST {baseUrl}/wand/si-image/generation。
 * 文生图只传 {model,prompt,size}；图生图追加 images[]（data:image/png;base64,…）。
 * 响应只回 URL，需再下载一次。
 */
async function callSiImageGeneration(
  http: GatewayHttpConfig,
  modelId: string,
  prompt: string,
  outPath: string,
  opts?: { refPaths?: string[]; signal?: AbortSignal; size?: string },
): Promise<GeneratedImage> {
  const body: Record<string, unknown> = { model: modelId, prompt, size: opts?.size ?? "1920x1088" };
  const refPaths = opts?.refPaths ?? [];
  if (refPaths.length > 0) {
    const used = refPaths.slice(0, SI_IMAGE_MAX_REFS);
    if (refPaths.length > used.length) {
      console.log(`[artist] si-image 参考图截断：${refPaths.length} > ${SI_IMAGE_MAX_REFS}`);
    }
    body.images = await Promise.all(
      used.map(async (p) => `data:image/png;base64,${(await readFile(p)).toString("base64")}`),
    );
  }
  const res = await fetch(`${http.baseUrl}/wand/si-image/generation`, {
    method: "POST",
    headers: { Authorization: `Bearer ${http.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: withTimeout(opts?.signal, IMAGE_GEN_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`si-image api HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: Array<{ url?: string; size?: string }> };
  const item = json.data?.[0];
  if (!item?.url) throw new Error("si-image api 无返回图片 URL");
  const buf = Buffer.from(await (await fetch(item.url)).arrayBuffer());
  const [w, h] = (item.size ?? "").split("x").map(Number);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, buf);
  return { path: outPath, width: w || 1920, height: h || 1088 };
}

export async function callImageEdits(
  prompt: string,
  refPaths: string[],
  outPath: string,
  signal?: AbortSignal,
  size?: string,
): Promise<GeneratedImage> {
  return withModelFallback("imageApi", async ({ ref }) => {
    console.log(
      `[artist] 图生图调用：model=${ref.modelId} gateway=${ref.gateway} refs=${refPaths.length} out=${outPath}`,
    );
    const http = getGatewayHttpConfig(ref.gateway);
    if (!http) {
      throw new Error(
        `${ref.gateway} 域未配置端点：请在 /settings 页或 .env 填写 ${endpointEnvHint(ref.gateway)}（模型 ${ref.modelId}）`,
      );
    }

    if (http.imageProtocol === "si-image") {
      return callSiImageGeneration(http, ref.modelId, prompt, outPath, { refPaths, signal, size });
    }

    const form = new FormData();
    form.append("model", ref.modelId);
    form.append("prompt", prompt);
    form.append("size", size ?? "1024x1024");
    form.append("response_format", "b64_json");

    for (const p of refPaths) {
      const buf = await readFile(p);
      form.append("image", new Blob([buf], { type: "image/png" }), "image.png");
    }

    const res = await fetch(`${http.baseUrl}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${http.apiKey}` },
      body: form,
      signal: withTimeout(signal, IMAGE_GEN_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`image edits API HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const item = json.data?.[0];
    const buf = item?.b64_json
      ? Buffer.from(item.b64_json, "base64")
      : item?.url
        ? Buffer.from(await (await fetch(item.url)).arrayBuffer())
        : (() => {
            throw new Error("image edits api 无返回图片");
          })();
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, buf);
    return { path: outPath, width: 1024, height: 1024 };
  });
}

export async function drawPanels(
  script: ComicScript,
  outDir: string,
  refPaths: string[] | ((panelIndex: number) => string[]),
  onPanel?: (index: number, result: { path?: string; error?: string }) => void,
  stylePreset?: string,
  signal?: AbortSignal,
  existing?: (string | null)[],
  layout?: string,
  size?: string,
): Promise<(string | null)[]> {
  const imgSize = layout === "tall" ? "1088x1920" : (size ?? "1920x1088");
  const limit = pLimit(getImageGenConcurrency());
  return Promise.all(
    script.panels.map((panel, i) =>
      limit(async () => {
        const kept = existing?.[i];
        if (kept) return kept;
        const outPath = await nextPanelPath(outDir, i);
        try {
          const panelRefs = typeof refPaths === "function" ? refPaths(i) : refPaths;
          const prompt = buildPanelPrompt(
            script,
            panel,
            i,
            stylePreset ?? getStylePreset(),
            layout,
            getNarrationInImage(),
          );
          const img = await pRetry(
            () => callImageEdits(prompt, panelRefs, outPath, signal, imgSize),
            {
              retries: 2,
              signal,
            },
          );
          onPanel?.(i, { path: img.path });
          return img.path;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          onPanel?.(i, { error: msg });
          return null;
        }
      }),
    ),
  );
}

export type SubjectPrompts = {
  style: string | null;
  scene: string | null;
  characters: Array<string | null>;
};

export type SubjectPromptOverrides = {
  style?: string;
  scene?: string;
  /** 以角色名作为稳定 key，避免删除角色后按下标错位 */
  characters?: Record<string, string>;
};

export function parseSubjectPromptOverrides(
  json: string | null | undefined,
): SubjectPromptOverrides {
  if (!json) return {};
  try {
    const value = JSON.parse(json) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const raw = value as { style?: unknown; scene?: unknown; characters?: unknown };
    const characters =
      raw.characters && typeof raw.characters === "object" && !Array.isArray(raw.characters)
        ? Object.fromEntries(
            Object.entries(raw.characters as Record<string, unknown>).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string" && entry[1].trim().length > 0,
            ),
          )
        : undefined;
    const normalized = (value: unknown) =>
      typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
    return {
      style: normalized(raw.style),
      scene: normalized(raw.scene),
      characters,
    };
  } catch {
    return {};
  }
}

/**
 * 组装各主体参考图的完整提示词（与单主体生成实际调用一致，保证"看到的"就是"发出去的"）：
 * 已绑定资产的主体不单独生成返回 null；未确认主体（无 refs）时从剧本骨架构建。
 */
export async function buildSubjectPrompts(options: {
  script: ComicScript | null;
  refs: TaskReferences | null;
  /** 画风样图 prompt 使用的画风描述（调用方按绑定/refs/默认值解析） */
  stylePreset: string;
  /** 场景/角色 prompt 使用的画风（调用方 stylePresetFor 解析） */
  characterPreset: string;
  /** 用户在主体提示词弹窗中保存的覆盖内容 */
  promptOverrides?: SubjectPromptOverrides;
}): Promise<SubjectPrompts> {
  const { script, refs, stylePreset, characterPreset, promptOverrides = {} } = options;
  if (!refs) {
    return {
      style: script ? promptOverrides.style?.trim() || buildStylePreviewPrompt(stylePreset) : null,
      // 主场景不再文生图（参考图仅来自绑定的场景资产），scene 提示词恒为 null
      scene: null,
      characters: script
        ? uniqueCast(script).map(
            (name) =>
              promptOverrides.characters?.[name]?.trim() ||
              buildCharacterViewPrompt(name, script.outfits?.[name]?.trim() ?? "", characterPreset),
          )
        : [],
    };
  }
  return {
    style: refs.style?.assetId
      ? null
      : promptOverrides.style?.trim() || buildStylePreviewPrompt(stylePreset),
    scene: null,
    characters: refs.characters.map((entry) =>
      entry.assetId
        ? null
        : promptOverrides.characters?.[entry.name]?.trim() ||
          buildCharacterViewPrompt(entry.name, entry.appearance ?? "", characterPreset),
    ),
  };
}

/** 角色三视图（文生图）：同一角色正/侧/背同框，纯色背景 */
export async function generateCharacterView(
  name: string,
  imagePrompt: string,
  preset: string,
  outPath: string,
  size?: string,
  opts?: { promptOverride?: string },
): Promise<GeneratedImage> {
  return callImageApi(
    opts?.promptOverride?.trim() || buildCharacterViewPrompt(name, imagePrompt, preset),
    outPath,
    size,
  );
}

/** 场景参考图（文生图）：空镜环境设定，画面不出现角色 */
export async function generateSceneView(
  description: string,
  preset: string,
  outPath: string,
  size?: string,
  opts?: { promptOverride?: string },
): Promise<GeneratedImage> {
  return callImageApi(
    opts?.promptOverride?.trim() || buildSceneViewPrompt(description, preset),
    outPath,
    size,
  );
}
