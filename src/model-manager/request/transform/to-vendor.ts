import { resolveModelProfile } from "../../catalog";
import type { ModelRef } from "../../types";
import type { TransformContext } from "../../catalog/types";
import type { UnifiedChatRequest } from "../types";
import { assertNoForeignExtensions, pickSafeExtension } from "./extension-filter";
import { applyFieldMap } from "./field-map";
import {
  assertVisionCapability,
  toVendorMessages,
  toVendorToolChoice,
  toVendorTools,
} from "./messages";

export interface VendorRequest {
  body: Record<string, unknown>;
}

export function toVendorRequest(req: UnifiedChatRequest, ref: ModelRef): VendorRequest {
  const profile = resolveModelProfile(ref);
  const stream = !!req.stream;
  const ctx: TransformContext = { ref, profile, stream };
  const merged: UnifiedChatRequest = { ...profile.defaults, ...req };

  assertNoForeignExtensions(merged, profile);
  const ext = pickSafeExtension(merged, profile);
  if (ext) {
    merged.extensions = { [profile.extensionKey]: ext };
  }

  assertVisionCapability(merged.messages, profile);

  const body: Record<string, unknown> = {
    model: ref.modelId,
    messages: toVendorMessages(merged.messages, profile, ctx, merged.visionDetail),
    stream,
  };

  const tools = toVendorTools(merged.tools, profile);
  if (tools) {
    body.tools = tools;
  }
  if (merged.toolChoice != null && profile.capabilities?.tools !== false) {
    body.tool_choice = toVendorToolChoice(merged.toolChoice);
  }

  applyFieldMap(body, merged, profile.fieldMap, stream);
  profile.adapter?.afterMap(body, merged, ctx);
  return { body };
}

export {
  toVendorMessages,
  toVendorTools,
  toVendorToolChoice,
  assertVisionCapability,
} from "./messages";
