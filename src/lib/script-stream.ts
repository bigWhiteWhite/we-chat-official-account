import { db } from "@/lib/db";
import { logTaskEvent } from "@/lib/task-events";
import { FeedRecorder } from "@/lib/feed-recorder";

import type { ComicScript } from "@/pipeline/schema";
import type { ScriptStreamEvent } from "@/pipeline/writer";

/**
 * 消费剧本流：逐事件转发给 SSE 回调，并落关键事件；
 * done → 保存 scriptJson/title 并置 script_ready；error/异常 → 置 failed 并抛错（由 SSE 层补 error 事件）。
 */
export async function pumpScriptStream(
  taskId: string,
  gen: AsyncGenerator<ScriptStreamEvent>,
  send: (ev: unknown) => void,
  options: { doneLabel?: string } = {},
): Promise<void> {
  const recorder = new FeedRecorder();
  try {
    for await (const ev of gen) {
      send(ev);
      recorder.push(ev);
      if (ev.type === "model") {
        await logTaskEvent(taskId, "writing", "llm_model", ev.model);
      } else if (ev.type === "prompt") {
        // 落库 LLM 提示词回显，刷新后仍可取回展示
        await logTaskEvent(taskId, "writing", "llm_prompt", ev.prompt.slice(0, 100), {
          system: ev.system,
          prompt: ev.prompt,
        });
      } else if (ev.type === "stage") {
        await logTaskEvent(taskId, "writing", "llm_stage", ev.message);
      } else if (ev.type === "done") {
        const script = ev.script as ComicScript;
        await db.task.updateMany({
          where: { taskId, status: "writing" },
          data: { scriptJson: JSON.stringify(script), title: script.title, status: "script_ready" },
        });
        await logTaskEvent(taskId, "writing", "script_done", script.title);
        recorder.markDone(options.doneLabel ?? "完成");
        await recorder.save(taskId, "writing");
      } else if (ev.type === "error") {
        await db.task.updateMany({
          where: { taskId, status: "writing" },
          data: { status: "failed", error: ev.message },
        });
        await logTaskEvent(taskId, "writing", "task_failed", ev.message);
        await recorder.save(taskId, "writing");
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.task.updateMany({
      where: { taskId, status: "writing" },
      data: { status: "failed", error: message },
    });
    await logTaskEvent(taskId, "writing", "task_failed", message);
    await recorder.save(taskId, "writing");
    throw err;
  }
}
