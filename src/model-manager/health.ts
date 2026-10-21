import { getHealthTimeoutMs } from "./config";
import { getGatewayHttpConfig } from "./providers/http";
import type { ApiType, ModelBizType } from "./types";

export interface TestModelParams {
  biz: ModelBizType;
  modelId: string;
  baseUrl: string;
  apiKey?: string;
  apiType?: ApiType;
}

const normBase = (s: string): string => s.trim().replace(/\/+$/, "");

/**
 * 探测用 key：表单填了就用表单的；留空时**仅在该域已保存的 Base URL 与表单一致**才复用库内 key
 * （否则等于把已存密钥发给用户手输的陌生端点）。都不满足才退回占位 key。
 */
function resolveProbeKey(
  biz: ModelBizType | undefined,
  baseUrl: string,
  apiKey?: string,
): { key: string; reusedSaved: boolean } {
  const typed = apiKey?.trim();
  if (typed) return { key: typed, reusedSaved: false };
  const cfg = biz ? getGatewayHttpConfig(biz) : null;
  if (cfg && cfg.apiKey !== "env" && normBase(cfg.baseUrl) === normBase(baseUrl)) {
    return { key: cfg.apiKey, reusedSaved: true };
  }
  return { key: "env", reusedSaved: false };
}

/** Key 留空且端点与已存配置不符时只能用占位 key 探测，401 要说清原因而不是让人以为 Key 错了 */
function authHint(status: number, key: string, reusedSaved: boolean): string {
  return status === 401 && key === "env" && !reusedSaved
    ? "（Key 留空且 Base URL 与已存配置不符，按占位 key 探测）"
    : "";
}

function minimalChatBody(modelId: string): Record<string, unknown> {
  return {
    model: modelId,
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 8,
    stream: false,
  };
}

function minimalResponsesBody(modelId: string): Record<string, unknown> {
  return {
    model: modelId,
    input: [{ role: "user", content: "hi" }],
    max_output_tokens: 8,
    stream: false,
  };
}

/**
 * 测试单个模型连通性（供设置页「测试连接」调用）。
 * baseUrl / apiKey / apiType 一律取表单当前值（可能尚未保存）；apiType 决定模型探测端点。
 * apiKey 留空时按 resolveProbeKey 复用该域已保存的 key（同 Base URL 才复用）。
 * biz === "imageApi" 时只探 /models（生图无统一 chat 探针）。不抛错，结果放返回值。
 */
export async function testModelConnection(
  params: TestModelParams,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  ok: boolean;
  latencyMs: number;
  stage: "http" | "chat" | "responses";
  error?: string;
}> {
  const started = Date.now();
  const { biz, modelId, baseUrl, apiKey, apiType = "chat" } = params;
  const raw = modelId.trim();
  if (!raw) {
    return { ok: false, latencyMs: 0, stage: "http", error: "模型 id 不能为空" };
  }
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) {
    return { ok: false, latencyMs: 0, stage: "http", error: "请先填写接口地址（Base URL）" };
  }
  const { key, reusedSaved } = resolveProbeKey(biz, base, apiKey);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), getHealthTimeoutMs());
  try {
    const probe = await fetchImpl(`${base}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    });
    if (!probe.ok && probe.status !== 404) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        stage: "http",
        error: `HTTP ${probe.status}${authHint(probe.status, key, reusedSaved)}`,
      };
    }
    if (biz === "imageApi") {
      return { ok: true, latencyMs: Date.now() - started, stage: "http" };
    }
    if (apiType === "responses") {
      const res = await fetchImpl(`${base}/responses`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(minimalResponsesBody(raw)),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          ok: false,
          latencyMs: Date.now() - started,
          stage: "responses",
          error: `HTTP ${res.status}${text ? `：${text.slice(0, 200)}` : ""}`,
        };
      }
      return { ok: true, latencyMs: Date.now() - started, stage: "responses" };
    }
    const chat = await fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(minimalChatBody(raw)),
      signal: ctrl.signal,
    });
    if (!chat.ok) {
      const text = await chat.text().catch(() => "");
      return {
        ok: false,
        latencyMs: Date.now() - started,
        stage: "chat",
        error: `HTTP ${chat.status}${text ? `：${text.slice(0, 200)}` : ""}`,
      };
    }
    return { ok: true, latencyMs: Date.now() - started, stage: "chat" };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      stage: "http",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 列模型（设置页主模型下拉数据源）：Key 留空时与 testModelConnection 同规则复用该域已存 key */
export async function listModels(
  params: { baseUrl: string; apiKey?: string; biz?: ModelBizType },
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const base = params.baseUrl.trim().replace(/\/+$/, "");
  if (!base) {
    throw new Error("请先填写接口地址（Base URL）");
  }
  const { key, reusedSaved } = resolveProbeKey(params.biz, base, params.apiKey);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), getHealthTimeoutMs());
  try {
    const res = await fetchImpl(`${base}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}${authHint(res.status, key, reusedSaved)}`);
    }
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    return (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
  } finally {
    clearTimeout(timer);
  }
}
