import { standardProfile } from "./profiles/standard";
import type { ModelProfile } from "./types";
import type { ModelRef } from "../types";

/**
 * 厂商 profile 表：当前为空——所有端点一律走 standardProfile 标准 OpenAI 映射。
 * 接需要非标参数的模型时，在 catalog/profiles/ 加一条纯数据 profile 并在此登记
 * （match.gateway 填业务域名，profile 里可声明 capabilities 做调用前能力过滤）。
 */
const profiles: ModelProfile[] = [];

export function resolveModelProfile(ref: Pick<ModelRef, "gateway" | "modelId">): ModelProfile {
  const exact = profiles.find(
    (p) => p.match.modelId === ref.modelId && (!p.match.gateway || p.match.gateway === ref.gateway),
  );
  if (exact) {
    return exact;
  }
  const prefixed = profiles
    .filter(
      (p) =>
        !!p.match.modelIdPrefix &&
        ref.modelId.startsWith(p.match.modelIdPrefix) &&
        (!p.match.gateway || p.match.gateway === ref.gateway),
    )
    .sort((a, b) => (b.match.modelIdPrefix?.length ?? 0) - (a.match.modelIdPrefix?.length ?? 0));
  if (prefixed[0]) {
    return prefixed[0];
  }
  // 标准映射兜底：profile 表未命中（含全部域级端点模型）用 standardProfile，不抛错
  return standardProfile;
}
