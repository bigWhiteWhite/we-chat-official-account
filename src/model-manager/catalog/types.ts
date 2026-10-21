import type { ModelGatewayId, ModelRef } from "../types";
import type { UnifiedChatRequest, UnifiedMessage } from "../request/types";

export type JsonSchemaLike = {
  type?: string | string[];
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
  default?: unknown;
  description?: string;
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  additionalProperties?: boolean;
};

export type FieldMapRule =
  | {
      from: string;
      to: string;
      clamp?: { min?: number; max?: number };
      enumMap?: Record<string, string>;
      whenStream?: boolean;
      whenNotStream?: boolean;
    }
  | { from: string; drop: true };

export interface ModelCapabilities {
  tools?: boolean;
  vision?: boolean;
  jsonMode?: boolean;
  streamUsage?: boolean;
}

export interface TransformContext {
  ref: ModelRef;
  profile: ModelProfile;
  stream: boolean;
}

export interface ModelRequestAdapter {
  afterMap(body: Record<string, unknown>, req: UnifiedChatRequest, ctx: TransformContext): void;
  mapMessages?(messages: UnifiedMessage[], ctx: TransformContext): unknown[];
}

export interface ModelProfile {
  match: {
    gateway?: ModelGatewayId;
    modelId?: string;
    modelIdPrefix?: string;
  };
  extensionKey: string;
  extensionSchema: JsonSchemaLike;
  capabilities?: ModelCapabilities;
  defaults?: Partial<UnifiedChatRequest>;
  fieldMap: FieldMapRule[];
  adapter?: ModelRequestAdapter;
  /** vendor body 上 thinking / reasoning 等注入说明（供 thinking-params 薄封装） */
  resolveVendorThinking?(
    modelId: string,
    ext?: Record<string, unknown>,
  ): Record<string, unknown> | null;
}
