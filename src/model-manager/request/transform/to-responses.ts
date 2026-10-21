import type { ModelRef } from "../../types";
import type { UnifiedChatRequest, UnifiedMessage } from "../types";

/** 将统一请求组装为 OpenAI Responses API（POST /responses）非流式请求体 */
export function toResponsesRequest(
  req: UnifiedChatRequest,
  ref: ModelRef,
): { body: Record<string, unknown> } {
  const mapContent = (content: UnifiedMessage["content"]): unknown => {
    if (typeof content === "string") {
      return content;
    }
    return content.map((p) =>
      p.type === "text"
        ? { type: "input_text", text: p.text }
        : { type: "input_image", image_url: p.image_url.url },
    );
  };

  const systems = req.messages.filter((m) => m.role === "system");
  const input = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: mapContent(m.content) }));

  const body: Record<string, unknown> = {
    model: ref.modelId,
    input,
    stream: false,
  };

  const instructions = systems
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (instructions) {
    body.instructions = instructions;
  }
  if (req.temperature != null) {
    body.temperature = req.temperature;
  }
  if (req.maxTokens != null) {
    body.max_output_tokens = req.maxTokens;
  }
  if (req.stop != null) {
    body.stop = req.stop;
  }
  if (req.responseFormat && req.responseFormat.type !== "text") {
    // 当前业务只用 json_object；json_schema 暂降级为 json_object，避免引入 schema name 约定
    body.text = { format: { type: "json_object" } };
  }
  return { body };
}
