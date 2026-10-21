import { type wrapLanguageModel } from "ai";

/** `wrapLanguageModel` 接受的 model 类型别名，供各 provider 的 createThinkingModel 复用。 */
export type WrapLMModel = Parameters<typeof wrapLanguageModel>[0]["model"];

/**
 * 配合 SSE 改写。Aihubmix / DeepSeek 等 thinking 模型把推理内容放在
 * `delta.reasoning_content` 里,这里改写成 `delta.content` 并用 `<think>...</think>`
 * 包裹,后续由 `extractReasoningMiddleware({ tagName: "think" })` 抽成 reasoning part。
 */
export const rewriteReasoningStream = (): TransformStream<Uint8Array, Uint8Array> => {
  let buffer = "";
  let inThink = false;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const rewriteEvent = (event: string): string => {
    const lines = event.split("\n");
    const out = lines.map((line) => {
      if (!line.startsWith("data: ")) {
        return line;
      }
      const payload = line.slice(6);
      if (payload === "[DONE]") {
        return line;
      }
      try {
        const json = JSON.parse(payload) as {
          choices?: {
            delta?: {
              content?: string | null;
              reasoning_content?: string | null;
              reasoning?: string | null;
            };
          }[];
        };
        const delta = json.choices?.[0]?.delta;
        if (!delta) {
          return line;
        }

        // 部分聚合网关（转发 gemini 等）会同时下发 `reasoning` 与 `reasoning_content` 两个
        // 内容相同的镜像字段。我们只以 reasoning_content 作为思考来源,删掉冗余的 reasoning,
        // 避免下游把同一段思考重复注入。
        if ("reasoning" in delta) {
          delete delta.reasoning;
        }

        if (delta.reasoning_content != null) {
          const text = (inThink ? "" : "<think>") + delta.reasoning_content;
          delta.content = text;
          delete delta.reasoning_content;
          inThink = true;
        } else if (inThink) {
          delta.content = "</think>" + (delta.content ?? "");
          inThink = false;
        }
        return "data: " + JSON.stringify(json);
      } catch {
        return line;
      }
    });
    return out.join("\n");
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        controller.enqueue(encoder.encode(rewriteEvent(event) + "\n\n"));
      }
    },
    flush(controller) {
      if (buffer) {
        controller.enqueue(encoder.encode(rewriteEvent(buffer)));
      }
    },
  });
};

/** 把上游流经 `rewriteReasoningStream` 改写后重新包成 Response，沿用原始 status / headers。 */
const pipeReasoning = (source: ReadableStream<Uint8Array>, res: Response): Response =>
  new Response(source.pipeThrough(rewriteReasoningStream()), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });

/**
 * thinking provider 响应侧收尾: reasoning_content 改写（MVP 无录制，record 参数保留签名兼容）。
 */
export const finalizeReasoningResponse = (
  res: Response,
  opts: {
    url: string;
    requestBody?: string;
    isStream: boolean;
    record: boolean;
    requestStartedAt: number;
  },
): Response => {
  const { isStream } = opts;
  if (!isStream || !res.body) {
    return res;
  }
  return pipeReasoning(res.body, res);
};
