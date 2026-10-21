import { ParamValidationError } from "../errors";
import type { UnifiedChatRequest } from "../types";
import type { JsonSchemaLike, ModelProfile } from "../../catalog/types";

function assertObjectSchema(value: unknown, schema: JsonSchemaLike, path: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ParamValidationError(`${path} 必须是对象`);
  }
  const obj = value as Record<string, unknown>;
  const props = schema.properties ?? {};
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(obj)) {
      if (!(key in props)) {
        throw new ParamValidationError(`${path}.${key} 不在 schema 允许列表`);
      }
    }
  }
  for (const [key, propSchema] of Object.entries(props)) {
    if (!(key in obj)) {
      continue;
    }
    const v = obj[key];
    if (propSchema.enum && !propSchema.enum.includes(v)) {
      throw new ParamValidationError(`${path}.${key} 非法枚举值: ${String(v)}`);
    }
  }
}

export function assertNoForeignExtensions(req: UnifiedChatRequest, profile: ModelProfile): void {
  if (!req.extensions) {
    return;
  }
  for (const key of Object.keys(req.extensions)) {
    if (key !== profile.extensionKey) {
      throw new ParamValidationError(`extensions.${key} 与模型 ${profile.extensionKey} 不匹配`);
    }
  }
}

export function pickSafeExtension(
  req: UnifiedChatRequest,
  profile: ModelProfile,
): Record<string, unknown> | undefined {
  const bag = req.extensions?.[profile.extensionKey];
  if (!bag) {
    return undefined;
  }
  assertObjectSchema(bag, profile.extensionSchema, `extensions.${profile.extensionKey}`);
  return bag;
}
