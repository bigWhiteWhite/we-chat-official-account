import { TransformError } from "../errors";
import type { UnifiedChatRequest, UnifiedMessage, UnifiedTool } from "../types";
import type { ModelProfile, TransformContext } from "../../catalog/types";

function hasImageParts(messages: UnifiedMessage[]): boolean {
  return messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"),
  );
}

export function assertVisionCapability(messages: UnifiedMessage[], profile: ModelProfile): void {
  if (hasImageParts(messages) && profile.capabilities?.vision === false) {
    throw new TransformError(`模型不支持 vision: ${profile.extensionKey}`);
  }
}

export function toVendorMessages(
  messages: UnifiedMessage[],
  profile: ModelProfile,
  ctx: TransformContext,
  visionDetail?: "auto" | "low" | "high",
): unknown[] {
  if (profile.adapter?.mapMessages) {
    return profile.adapter.mapMessages(messages, ctx);
  }
  return messages.map((m) => {
    const out: Record<string, unknown> = { role: m.role };
    if (typeof m.content === "string") {
      out.content = m.content;
    } else {
      out.content = m.content.map((p) => {
        if (p.type === "text") {
          return { type: "text", text: p.text };
        }
        const detail = p.image_url.detail ?? visionDetail;
        return {
          type: "image_url",
          image_url: {
            url: p.image_url.url,
            ...(detail ? { detail } : {}),
          },
        };
      });
    }
    if (m.toolCallId) {
      out.tool_call_id = m.toolCallId;
    }
    if (m.toolCalls) {
      out.tool_calls = m.toolCalls;
    }
    if (m.name) {
      out.name = m.name;
    }
    return out;
  });
}

export function toVendorTools(
  tools: UnifiedTool[] | undefined,
  profile: ModelProfile,
): unknown[] | undefined {
  if (!tools?.length) {
    return undefined;
  }
  if (profile.capabilities?.tools === false) {
    return undefined;
  }
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function toVendorToolChoice(
  toolChoice: NonNullable<UnifiedChatRequest["toolChoice"]>,
): unknown {
  if (toolChoice === "auto" || toolChoice === "none") {
    return toolChoice;
  }
  return { type: "function", function: { name: toolChoice.name } };
}
