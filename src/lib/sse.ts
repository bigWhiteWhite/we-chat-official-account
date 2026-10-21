/**
 * SSE（NDJSON）工具，同文件供两端使用：
 * - 服务端 createSseStream：把 run 回调包装为 text/event-stream 响应；异常自动发 error 事件后关闭。
 * - 客户端 streamPost：fetch + ReadableStream 解析 `data:` 帧并逐条回调 onEvent。
 */
export function createSseStream(run: (send: (ev: unknown) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  let streamClosed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 客户端断开（如手动关闭弹窗）时流会被关闭：send 静默降级为 no-op，
      // 服务端 run 继续跑完并落库（可重开任务续看），不再抛 "Controller is already closed"。
      const send = (ev: unknown): void => {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          streamClosed = true;
        }
      };
      try {
        await run(send);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send({ type: "error", message: msg });
      } finally {
        try {
          controller.close();
        } catch {
          // 客户端已断开、流已被关闭则忽略
        }
        streamClosed = true;
      }
    },
    cancel: () => {
      // 客户端断开（关弹窗/切页）时 ReadableStream 会取消本流：仅置位，
      // 由 start 的 finally 统一 close，避免双重 close 触发 "Controller is already closed"。
      streamClosed = true;
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

/** 客户端流式 POST：逐帧解析 NDJSON；非 2xx 或网络错误抛错（AbortError 原样上抛）。 */
export async function streamPost(
  url: string,
  body: unknown,
  onEvent: (ev: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `请求失败（${res.status}）`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of frame.split("\n")) {
        const l = line.trim();
        if (!l.startsWith("data:")) continue;
        const payload = l.slice(5).trim();
        if (!payload) continue;
        try {
          onEvent(JSON.parse(payload) as Record<string, unknown>);
        } catch {
          // 忽略无法解析的帧
        }
      }
    }
  }
}
