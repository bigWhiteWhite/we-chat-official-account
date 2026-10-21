export class ParamValidationError extends Error {
  readonly code = "param_validation";
  constructor(message: string) {
    super(message);
    this.name = "ParamValidationError";
  }
}

export class TransformError extends Error {
  readonly code = "transform_error";
  constructor(message: string) {
    super(message);
    this.name = "TransformError";
  }
}

/** 调用前能力过滤：域主模型缺必需能力（vision / jsonMode），报错让使用方换模型 */
export class CapabilityMismatchError extends Error {
  readonly code = "capability_mismatch";
  readonly failureKind = "capability" as const;
  constructor(ref: string, capability: string) {
    super(`模型 ${ref} 不具备必需能力 ${capability}，请在 /settings 页更换该域主模型`);
    this.name = "CapabilityMismatchError";
  }
}
