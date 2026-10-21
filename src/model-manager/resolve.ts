import { BIZ_ENV_INFIX } from "./catalog/gateways";
import type { ModelGatewayId, ModelRef } from "./types";

const GATEWAYS = new Set<ModelGatewayId>(Object.keys(BIZ_ENV_INFIX));

/**
 * 解析 `gateway/modelId`。modelId 可含 `/`（极少见），以第一个 `/` 分割。
 * 网关前缀只有四个业务域名（main / mainLight / vision / imageApi），指向该域配置的端点。
 */
export function resolveModelRef(id: string): ModelRef {
  const trimmed = id.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    throw new Error(`非法模型引用（需 域/modelId）: ${id}`);
  }
  const gateway = trimmed.slice(0, slash) as ModelGatewayId;
  const modelId = trimmed.slice(slash + 1);
  if (!GATEWAYS.has(gateway)) {
    throw new Error(
      `未知网关前缀: ${gateway}（网关即业务域，可用: ${Object.keys(BIZ_ENV_INFIX).join("|")}；` +
        `主模型正常写裸 modelId 即绑定本域端点，端点在 /settings 页或 .env 的 MODEL_<域>_BASE_URL 配置）`,
    );
  }
  if (!modelId.trim()) {
    throw new Error(`非法模型引用（modelId 为空）: ${id}`);
  }
  return { id: `${gateway}/${modelId}`, gateway, modelId };
}
