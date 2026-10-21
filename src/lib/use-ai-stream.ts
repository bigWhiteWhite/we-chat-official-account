"use client";

import { useCallback, useRef, useState } from "react";

import { nextFeedId, type FeedItem } from "@/components/ai-feed";
import { streamPost } from "@/lib/sse";

/** 安全中止：忽略已中止/已关闭的 controller，避免抛出 "Controller is already closed" */
function abortSafely(controller: AbortController | null | undefined) {
  if (!controller || controller.signal.aborted) return;
  try {
    controller.abort();
  } catch {
    // controller 可能已随请求结束而关闭，忽略即可
  }
}

/** 单条 SSE 帧事件。 */
export type SseEvent = Record<string, unknown>;

/** FeedItem 去掉 id（保留可辨识联合）。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type FeedItemInput = DistributiveOmit<FeedItem, "id">;

export interface AiStreamOptions {
  /** done 事件的完成文案；函数会在事件到达时求值，支持动态值。 */
  doneLabel?: string | (() => string);
  /** 领域事件自定义处理；返回 true 表示已处理、跳过通用归约。 */
  onEvent?: (ev: SseEvent) => boolean | void;
  /** 流结束（成功 / 失败 / 非主动中断）后回调，常用于刷新缓存。 */
  onSettled?: () => void;
  /** 网络错误 / 非 2xx（流内 error 事件只进 feed，不触发此回调）。 */
  onError?: (message: string) => void;
}

export interface AiStream {
  items: FeedItem[];
  streaming: boolean;
  /** 启动一个流式 POST（若已有进行中的流则先中止）。不清空 items，需要清空请调用 reset()。 */
  start: (url: string, body?: unknown) => Promise<void>;
  abort: () => void;
  reset: () => void;
  pushUser: (message: string) => void;
  /** 手动追加一条 feed 项（领域事件自定义渲染时用于补 text 项）。 */
  push: (item: FeedItemInput) => void;
  /** 用持久化快照恢复 AI 过程（回看已完成步骤时调用）。 */
  restore: (items: FeedItem[]) => void;
}

/**
 * SSE 事件 → FeedItem 归约：text/thinking 增量合并（追加到末尾 live 块）+ 类型映射。
 * 剧本创作 / 主体确认 / 主体扩展三处共用此逻辑；领域事件可通过 onEvent 前置拦截。
 */
export function reduceFeedItem(prev: FeedItem[], ev: SseEvent, doneLabel: string): FeedItem[] {
  const type = ev.type as string;
  let next: FeedItem[] = prev.map((it) =>
    (it.type === "text" || it.type === "thinking") && it.live && it.type !== type
      ? { ...it, live: false }
      : it,
  );
  if (type === "text" || type === "thinking") {
    const delta = String(ev.content ?? "");
    const last = next[next.length - 1];
    if (
      last &&
      (last.type === "text" || last.type === "thinking") &&
      last.live &&
      last.type === type
    ) {
      next = [...next.slice(0, -1), { ...last, text: last.text + delta }];
    } else {
      next = [...next, { id: nextFeedId(), type, text: delta, live: true } as FeedItem];
    }
  } else if (type === "model") {
    next = [...next, { id: nextFeedId(), type: "model", model: String(ev.model ?? "") }];
  } else if (type === "stage") {
    next = [...next, { id: nextFeedId(), type: "stage", message: String(ev.message ?? "") }];
  } else if (type === "tool") {
    next = [
      ...next,
      { id: nextFeedId(), type: "tool", name: String(ev.name ?? "tool"), args: ev.args },
    ];
  } else if (type === "fallback") {
    next = [
      ...next,
      { id: nextFeedId(), type: "fallback", from: String(ev.from ?? ""), to: String(ev.to ?? "") },
    ];
  } else if (type === "error") {
    next = [
      ...next,
      { id: nextFeedId(), type: "error", message: String(ev.message ?? "未知错误") },
    ];
  } else if (type === "done") {
    next = [...next, { id: nextFeedId(), type: "done", label: doneLabel }];
  }
  return next;
}

/**
 * AI 流式 hook：封装 streamPost + FeedItem 累积 + 中止 / 重置。
 * 用法：const { items, streaming, start } = useAiStream({ doneLabel, onEvent, onSettled, onError });
 */
export function useAiStream(options: AiStreamOptions = {}): AiStream {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const handleEvent = useCallback((ev: SseEvent) => {
    if (optionsRef.current.onEvent?.(ev) === true) return;
    const d = optionsRef.current.doneLabel;
    const doneLabel = typeof d === "function" ? d() : (d ?? "完成");
    setItems((prev) => reduceFeedItem(prev, ev, doneLabel));
  }, []);

  const start = useCallback(
    async (url: string, body?: unknown) => {
      const seq = ++seqRef.current;
      abortSafely(abortRef.current);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStreaming(true);
      try {
        await streamPost(url, body, handleEvent, ctrl.signal);
      } catch (err) {
        const e = err as Error;
        if (e.name !== "AbortError" && seq === seqRef.current) {
          const message = e.message || String(err);
          setItems((prev) => [
            ...prev.map((it) =>
              (it.type === "text" || it.type === "thinking") && it.live
                ? { ...it, live: false }
                : it,
            ),
            { id: nextFeedId(), type: "error", message } as FeedItem,
          ]);
          optionsRef.current.onError?.(message);
        }
      } finally {
        if (seq === seqRef.current) {
          setStreaming(false);
          optionsRef.current.onSettled?.();
        }
      }
    },
    [handleEvent],
  );

  const abort = useCallback(() => abortSafely(abortRef.current), []);
  const reset = useCallback(() => setItems([]), []);
  const pushUser = useCallback((message: string) => {
    setItems((prev) => [...prev, { id: nextFeedId(), type: "user", message }]);
  }, []);
  const push = useCallback((item: FeedItemInput) => {
    setItems((prev) => [...prev, { ...item, id: nextFeedId() } as FeedItem]);
  }, []);

  const restore = useCallback((next: FeedItem[]) => {
    setItems(next);
  }, []);

  // 组件卸载不主动 abort：服务端流会继续执行并落库（关弹窗可续看），
  // 也避免 abort 已结束/已关闭的 controller 触发 "Controller is already closed"。

  return { items, streaming, start, abort, reset, pushUser, push, restore };
}
