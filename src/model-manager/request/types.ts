/** 统一请求 / 响应 DTO（业务只认这些类型） */

export interface UnifiedTool {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface UnifiedMessage {
  role: "system" | "user" | "assistant" | "tool";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
      >;
  name?: string;
  toolCallId?: string;
  toolCalls?: unknown[];
}

export interface UnifiedChatRequest {
  /** 域/modelId；也可由调用方省略，由 biz 解析后填入 */
  modelRef?: string;
  messages: UnifiedMessage[];
  stream?: boolean;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string | string[];
  seed?: number;
  responseFormat?: { type: "text" | "json_object" | "json_schema"; jsonSchema?: unknown };
  tools?: UnifiedTool[];
  toolChoice?: "auto" | "none" | { name: string };
  visionDetail?: "auto" | "low" | "high";
  streamOptions?: { includeUsage?: boolean };
  /** 模型私有扩展；key = profile.extensionKey */
  extensions?: Record<string, Record<string, unknown>>;
}

export type UnifiedFinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "error"
  | "unknown";

export interface UnifiedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface UnifiedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

export interface UnifiedChatResponse {
  id: string;
  model: string;
  content: string;
  reasoning?: string;
  toolCalls?: UnifiedToolCall[];
  finishReason: UnifiedFinishReason;
  usage?: UnifiedUsage;
  raw?: unknown;
}

export interface UnifiedError {
  code: string;
  message: string;
  httpStatus?: number;
  retryable: boolean;
  vendor?: unknown;
}

export type UnifiedStreamEvent =
  | { type: "delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call_delta"; index: number; id?: string; name?: string; argumentsDelta?: string }
  | { type: "usage"; usage: UnifiedUsage }
  | { type: "done"; finishReason: UnifiedFinishReason; response?: UnifiedChatResponse }
  | { type: "error"; error: UnifiedError };
