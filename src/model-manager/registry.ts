import { BIZ_ENV_INFIX, getEnvGatewayConfig } from "./catalog/gateways";
import { getPrimaryFromEnv } from "./config";
import { resolveModelRef } from "./resolve";
import type { ModelBizType, ModelRef } from "./types";

/**
 * 每个业务域只有一个主模型：MODEL_<域>_PRIMARY（/settings 页或 .env，DB 覆盖 env）。
 * 主模型写裸 modelId，绑定该域端点（MODEL_<域>_BASE_URL，缺省回落全局 MODEL_BASE_URL）；
 * 也可显式写 `域/modelId` 借用别的域端点。不可解析一律抛错（含变量名与配置入口）。
 */
function resolvePrimaryId(biz: ModelBizType): string {
  const infix = BIZ_ENV_INFIX[biz];
  const id = getPrimaryFromEnv(biz);
  if (!id) {
    throw new Error(
      `业务域 ${biz} 未配置主模型：请在 /settings 页「模型配置」或 .env 填写 MODEL_${infix}_PRIMARY` +
        `（裸 modelId，同时配 MODEL_${infix}_BASE_URL / MODEL_${infix}_API_KEY）`,
    );
  }
  if (id.includes("/")) {
    resolveModelRef(id);
    return id;
  }
  if (getEnvGatewayConfig(biz)) {
    return `${biz}/${id}`;
  }
  throw new Error(
    `MODEL_${infix}_PRIMARY=${id} 为裸 modelId，需先在 /settings 页或 .env 配置 MODEL_${infix}_BASE_URL（或全局 MODEL_BASE_URL）+ 对应 API_KEY`,
  );
}

/** 单元素数组形态：降级循环与能力校验仍按链处理 */
export function getModelChain(biz: ModelBizType): string[] {
  return [resolvePrimaryId(biz)];
}

/** 当前域配置的主模型引用 */
export function getPrimaryRef(biz: ModelBizType): ModelRef {
  return resolveModelRef(resolvePrimaryId(biz));
}
