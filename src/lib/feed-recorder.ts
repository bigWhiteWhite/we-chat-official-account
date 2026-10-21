import { logTaskEvent } from "@/lib/task-events";

/** 落库的 AI 过程流单项（与前端 FeedItem 同形，去掉 id/live） */
export type FeedItemPayload =
  | { type: "model"; model: string }
  | { type: "stage"; message: string }
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; args?: unknown }
  | { type: "fallback"; from: string; to: string }
  | { type: "error"; message: string }
  | { type: "done"; label: string };

/**
 * 服务端 AI 过程记录器：按前端 reduceFeedItem 相同口径合并流式事件
 * （text/thinking 增量合并为整块），运行结束时把整份 feed 作为
 * ai_feed 事件落库，供步骤回看 / 刷新后恢复 AI 过程。
 */
export class FeedRecorder {
  private items: FeedItemPayload[] = [];
  private liveType: "text" | "thinking" | null = null;

  push(ev: { type: string; [key: string]: unknown }): void {
    const { type } = ev;
    if (type === "text" || type === "thinking") {
      const delta = String(ev.content ?? "");
      if (!delta) return;
      const last = this.items[this.items.length - 1];
      if (this.liveType === type && last && (last.type === "text" || last.type === "thinking")) {
        last.text += delta;
      } else {
        this.items.push({ type, text: delta });
      }
      this.liveType = type;
      return;
    }
    if (type === "prompt" || type === "subject") return;
    this.liveType = null;
    if (type === "model") {
      this.items.push({ type: "model", model: String(ev.model ?? "") });
    } else if (type === "stage") {
      this.items.push({ type: "stage", message: String(ev.message ?? "") });
    } else if (type === "tool") {
      this.items.push({ type: "tool", name: String(ev.name ?? "tool"), args: ev.args });
    } else if (type === "fallback") {
      this.items.push({ type: "fallback", from: String(ev.from ?? ""), to: String(ev.to ?? "") });
    } else if (type === "error") {
      this.items.push({ type: "error", message: String(ev.message ?? "未知错误") });
    }
  }

  markDone(label: string): void {
    this.liveType = null;
    this.items.push({ type: "done", label });
  }

  async save(taskId: string, stage: string): Promise<void> {
    if (this.items.length === 0) return;
    await logTaskEvent(taskId, stage, "ai_feed", "", { items: this.items });
  }
}
