import { getFallbackCooldownMs, isAutoFallbackEnabled } from "./config";
import { getModelChain } from "./registry";
import { resolveModelRef } from "./resolve";
import type { FailureKind, ModelBizType, ModelRef } from "./types";

interface ActiveCacheEntry {
  modelId: string;
  until: number;
}

const activeByBiz = new Map<ModelBizType, ActiveCacheEntry>();

export function clearModelFallbackState(): void {
  activeByBiz.clear();
}

export function getActiveModelId(biz: ModelBizType): string {
  const cached = activeByBiz.get(biz);
  const now = Date.now();
  if (cached && cached.until > now) {
    return cached.modelId;
  }
  return getModelChain(biz)[0]!;
}

export function getActiveModelRef(biz: ModelBizType): ModelRef {
  return resolveModelRef(getActiveModelId(biz));
}

function markActive(biz: ModelBizType, modelId: string): void {
  activeByBiz.set(biz, {
    modelId,
    until: Date.now() + getFallbackCooldownMs(),
  });
}

export function classifyFailure(err: unknown): FailureKind {
  if (err && typeof err === "object" && "failureKind" in err) {
    const k = (err as { failureKind: FailureKind }).failureKind;
    if (k) {
      return k;
    }
  }

  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (/econnrefused|enotfound|fetch failed|network|socket|dns/i.test(msg)) {
    return "network";
  }
  if (/timeout|timed out|abort/i.test(lower)) {
    return "timeout";
  }
  if (/\b429\b|rate.?limit|quota/i.test(lower)) {
    return "rate_limit";
  }
  if (/\b50[234]\b|\b500\b|bad gateway|service unavailable|gateway/i.test(lower)) {
    return "gateway_5xx";
  }
  if (/empty payload|choices:\s*\[\]|no content|空有效/i.test(lower)) {
    return "empty_payload";
  }
  if (/\b401\b|\b403\b|unauthorized|forbidden/i.test(lower)) {
    return "auth";
  }
  if (/content.?policy|safety|违规|拦截/i.test(lower)) {
    return "safety";
  }
  if (/\b4\d{2}\b/.test(msg)) {
    return "client_4xx";
  }
  return "unknown";
}

/** 基础设施类故障可降级；业务/安全类不降级。
 * auth（401/403）按「当前网关凭证失败」处理；capability（能力校验）视为当前模型不适用。
 * 二者仅在多候选链时切换下一模型，单模型链下直接把原始错误抛给使用方换配置。 */
export function isRetryableFailure(kind: FailureKind): boolean {
  return (
    kind === "network" ||
    kind === "timeout" ||
    kind === "gateway_5xx" ||
    kind === "rate_limit" ||
    kind === "empty_payload" ||
    kind === "auth" ||
    kind === "capability" ||
    kind === "unknown"
  );
}

export class ModelFallbackAggregateError extends Error {
  readonly attempts: Array<{ ref: ModelRef; reason: string; kind: FailureKind }>;

  constructor(
    biz: ModelBizType,
    attempts: Array<{ ref: ModelRef; reason: string; kind: FailureKind }>,
  ) {
    const detail = attempts.map((a) => `${a.ref.id}: ${a.reason}`).join(" | ");
    super(`业务域 ${biz} 全部候选模型失败: ${detail}`);
    this.name = "ModelFallbackAggregateError";
    this.attempts = attempts;
  }
}

export interface WithModelFallbackContext {
  biz: ModelBizType;
  ref: ModelRef;
}

/**
 * 按域模型链执行（当前每域只有一项）；可降级错误切下一模型；成功则写入冷却期内活跃模型。
 */
export async function withModelFallback<T>(
  biz: ModelBizType,
  fn: (ctx: WithModelFallbackContext) => Promise<T>,
): Promise<T> {
  const chain = getModelChain(biz);
  const auto = isAutoFallbackEnabled();
  const ordered = (() => {
    const active = getActiveModelId(biz);
    if (!auto || active === chain[0]) {
      return chain;
    }
    return [active, ...chain.filter((c) => c !== active)];
  })();

  const attempts: Array<{ ref: ModelRef; reason: string; kind: FailureKind }> = [];

  for (let i = 0; i < ordered.length; i++) {
    const id = ordered[i]!;
    const ref = resolveModelRef(id);
    try {
      const result = await fn({ biz, ref });
      markActive(biz, id);
      if (i > 0) {
        console.warn(
          `[model-manager] fallback ok biz=${biz} from=${attempts[attempts.length - 1]?.ref.id ?? "?"} to=${id}`,
        );
      }
      return result;
    } catch (err) {
      const kind = classifyFailure(err);
      const reason = err instanceof Error ? err.message : String(err);
      attempts.push({ ref, reason, kind });
      console.warn(
        `[model-manager] attempt failed biz=${biz} model=${id} kind=${kind} reason=${reason.slice(0, 200)}`,
      );

      if (!auto || !isRetryableFailure(kind) || i === ordered.length - 1) {
        // 只试过一次的原始错误更可读，聚合错误留给真正跑完多候选链的场景
        if (attempts.length === 1) {
          throw err;
        }
        if (i === ordered.length - 1) {
          throw new ModelFallbackAggregateError(biz, attempts);
        }
        throw err;
      }
    }
  }

  throw new ModelFallbackAggregateError(biz, attempts);
}
