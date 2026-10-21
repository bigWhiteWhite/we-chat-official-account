import { nextFeedId, type FeedItem } from "@/components/ai-feed";
import type { StageEventRow } from "@/lib/api";
import type { FeedItemPayload } from "@/lib/feed-recorder";

/**
 * 从任务事件恢复 AI 过程流：
 * 服务端每次 AI 运行结束（done/error）都会落一条 ai_feed 快照（payload = 本次运行完整 feed），
 * 这里取指定 stage 最近一条快照还原为前端 FeedItem，用于回看步骤 / 刷新后恢复。
 */
export function restoreFeedFromEvents(
  events: StageEventRow[] | undefined,
  stage: string,
): FeedItem[] {
  if (!events) return [];
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.stage !== stage || ev.eventType !== "ai_feed" || !ev.payloadJson) continue;
    try {
      const payload = JSON.parse(ev.payloadJson) as { items?: FeedItemPayload[] };
      return (payload.items ?? []).map((it) => {
        const base = { ...it, id: nextFeedId() };
        if (base.type === "text" || base.type === "thinking") {
          return { ...base, live: false } as FeedItem;
        }
        return base as FeedItem;
      });
    } catch {
      return [];
    }
  }
  return [];
}
