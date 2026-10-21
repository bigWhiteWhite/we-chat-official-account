import { streamText } from "ai";

import { getModel, getModelRef } from "@/model-manager";

import type { ComicScript, TagSpec } from "./schema";
import { buildCreatePrompt, buildRevisePrompt } from "./prompts/writer";
import { parseScriptOutput } from "./script-md";

export type ScriptStreamEvent =
  | { type: "model"; model: string }
  | { type: "prompt"; system: string; prompt: string }
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool"; name: string; args: unknown }
  | { type: "stage"; message: string }
  | { type: "done"; script: ComicScript }
  | { type: "error"; message: string };

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type StreamPart = {
  type: string;
  text?: string;
  delta?: string;
  textDelta?: string;
  reasoningDelta?: string;
  toolName?: string;
  toolCall?: { toolName?: string; input?: unknown };
  error?: { message?: string };
};

/**
 * 流式生成（或按意见重写）剧本，逐条 yield 事件：
 * model -> stage -> text*（剧本正文流）/ thinking*（思考流）/ tool* -> done(script) 或 error。
 * 正文实时流出供前端展示；结束后本地宽容解析（Markdown 优先，JSON 兜底），
 * 最多 3 次尝试，失败即重试并 yield stage 说明。
 */
export async function* writeScriptStream(input: {
  outline: string;
  sourceType: ComicScript["source"];
  sourceUrl?: string;
  mode?: "create" | "revise";
  currentScript?: ComicScript;
  message?: string;
  /** 内容标签（名称+说明），注入创建剧本的 prompt */
  tags?: TagSpec[];
  /** 合集（连载）上下文段落，由调用方用 buildSeriesPromptSection 生成 */
  seriesSection?: string;
  signal?: AbortSignal;
}): AsyncGenerator<ScriptStreamEvent> {
  const ref = getModelRef("main");
  yield { type: "model", model: ref.id };

  const { system, prompt } =
    input.mode === "revise" && input.currentScript
      ? buildRevisePrompt(
          input.outline,
          input.currentScript,
          input.message ?? "",
          input.seriesSection,
        )
      : buildCreatePrompt(input.outline, input.tags ?? [], input.seriesSection);

  // 回显：LLM 实际收到的完整提示词（system + user），前端拦截展示并落库任务事件
  yield { type: "prompt", system, prompt };

  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    yield {
      type: "stage",
      message:
        attempt === 1
          ? input.mode === "revise"
            ? "正在按修改意见重写剧本…"
            : "正在调用大模型生成剧本…"
          : `第 ${attempt}/${maxAttempts} 次重试…`,
    };
    try {
      const model = getModel("main");
      const result = streamText({ model, system, prompt, abortSignal: input.signal });
      let full = "";
      let producedThinking = false;
      for await (const raw of result.fullStream) {
        const part = raw as StreamPart;
        if (part.type === "text-delta") {
          const delta = part.text ?? part.textDelta ?? part.delta ?? "";
          full += delta;
          yield { type: "text", content: delta };
        } else if (part.type === "reasoning-delta") {
          producedThinking = true;
          yield { type: "thinking", content: part.text ?? part.delta ?? part.reasoningDelta ?? "" };
        } else if (part.type === "tool-call") {
          yield {
            type: "tool",
            name: part.toolName ?? part.toolCall?.toolName ?? "tool",
            args: part.toolCall?.input ?? null,
          };
        } else if (part.type === "error") {
          throw new Error(part.error?.message ?? "stream error");
        }
      }
      const script = parseScriptOutput(full, input.sourceType, input.sourceUrl ?? "");
      if (!producedThinking) {
        yield { type: "stage", message: "该模型未输出思考过程（正文已实时流式输出）" };
      }
      yield { type: "done", script };
      return;
    } catch (err) {
      lastErr = err;
      if (input.signal?.aborted || (err as Error)?.name === "AbortError") {
        return;
      }
      if (attempt < maxAttempts) {
        yield { type: "stage", message: `生成失败，准备重试：${errMsg(err)}` };
      }
    }
  }
  yield { type: "error", message: errMsg(lastErr) };
}
