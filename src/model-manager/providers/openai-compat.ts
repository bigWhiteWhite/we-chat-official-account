import { createOpenAI } from "@ai-sdk/openai";
import { extractReasoningMiddleware, wrapLanguageModel } from "ai";

import type { GatewayConfig } from "../catalog/gateways";
import { applyProfileVendorBodyPatch } from "./profile-body-patch";
import { finalizeReasoningResponse, type WrapLMModel } from "./utils";

/**
 * OpenAI 兼容网关单一工厂：端点、鉴权、协议一律来自域级配置，不做厂商怪癖分支。
 * thinking 变体统一：请求侧按 catalog profile 注入 vendor patch（thinking-params），
 * 响应侧把 reasoning_content 改写为 think 标签后由 extractReasoningMiddleware 抽取。
 */

type RouteKind = "chat" | "responses" | "other";

const detectRoute = (url: string): RouteKind => {
  if (url.includes("/chat/completions")) {
    return "chat";
  }
  if (url.includes("/v1/responses") || url.endsWith("/responses")) {
    return "responses";
  }
  return "other";
};

const getRequestUrl = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

export interface CompatProvider {
  createModel(modelId: string): WrapLMModel;
  createThinkingModel(modelId: string): WrapLMModel;
}

/** 按网关配置 + 凭证创建 provider（每次调用新建，配置变更即时生效） */
export function createCompatProvider(
  cfg: GatewayConfig,
  creds: { baseUrl: string; apiKey: string },
): CompatProvider {
  // apiType=responses 时，AI-SDK 走 OpenAI Responses 协议（provider.responses），否则走 chat
  const useResponses = cfg.apiType === "responses";
  const pickModel = (base: ReturnType<typeof createOpenAI>, modelId: string): WrapLMModel =>
    (useResponses ? base.responses(modelId) : base.chat(modelId)) as unknown as WrapLMModel;

  const transformBody = (rawBody: string): string => {
    try {
      const body = JSON.parse(rawBody) as Record<string, unknown>;
      applyProfileVendorBodyPatch(body, cfg.id);
      return JSON.stringify(body);
    } catch {
      return rawBody;
    }
  };

  const makeFetch = (thinking: boolean): typeof fetch => {
    return async (input, init) => {
      const url = getRequestUrl(input);
      const route = detectRoute(url);
      let requestInit = init;
      if (thinking && requestInit?.body && typeof requestInit.body === "string") {
        requestInit = { ...requestInit, body: transformBody(requestInit.body) };
      }

      const requestStartedAt = Date.now();
      const res = await fetch(input as RequestInfo, requestInit);

      if (!thinking) {
        return res;
      }

      const isChat = route === "chat";
      const contentType = res.headers.get("content-type") ?? "";
      const isStream = isChat && res.ok && !!res.body && contentType.includes("text/event-stream");

      return finalizeReasoningResponse(res, {
        url,
        requestBody:
          requestInit?.body && typeof requestInit.body === "string" ? requestInit.body : undefined,
        isStream,
        record: isChat,
        requestStartedAt,
      });
    };
  };

  const base = createOpenAI({
    baseURL: creds.baseUrl,
    apiKey: creds.apiKey,
    fetch: makeFetch(false),
  });
  const withThinking = createOpenAI({
    baseURL: creds.baseUrl,
    apiKey: creds.apiKey,
    fetch: makeFetch(true),
  });

  return {
    createModel: (modelId) => pickModel(base, modelId),
    createThinkingModel: (modelId) =>
      wrapLanguageModel({
        model: pickModel(withThinking, modelId),
        // startWithReasoning:false —— responses 协议下多数端点不产出 think 标签时中间件为空操作
        middleware: extractReasoningMiddleware({ tagName: "think", startWithReasoning: false }),
      }),
  };
}
