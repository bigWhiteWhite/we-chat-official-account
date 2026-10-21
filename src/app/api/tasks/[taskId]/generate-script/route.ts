import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { hasAnyRun, registerRun, unregisterRun } from "@/lib/inflight";
import { pumpScriptStream } from "@/lib/script-stream";
import { createSseStream } from "@/lib/sse";
import { logTaskEvent } from "@/lib/task-events";
import { getSeriesContextForTask } from "@/lib/series";
import { buildSeriesPromptSection } from "@/pipeline/prompts/series";
import type { ComicScript, TagSpec } from "@/pipeline/schema";
import { pickTopics } from "@/pipeline/topic";
import { writeScriptStream } from "@/pipeline/writer";

/** SSE：流式生成剧本（无大纲时先选题）；done 后存 scriptJson+title，状态 script_ready。支持 abortRun 手动停止。 */
export async function POST(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  if (hasAnyRun(taskId)) {
    return NextResponse.json({ error: "该任务有生成任务进行中，请稍候" }, { status: 409 });
  }
  const task = await db.task.findUnique({
    where: { taskId },
    include: { tags: { include: { tag: true } } },
  });
  if (!task) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const tags: TagSpec[] = task.tags.map((x) => ({
    name: x.tag.name,
    description: x.tag.description,
  }));

  let outline = task.outlineText;
  if (!outline) {
    const [topic] = await pickTopics(1, tags);
    if (!topic) {
      await db.task.update({
        where: { taskId },
        data: { status: "failed", error: "无可用选题" },
      });
      await logTaskEvent(taskId, "writing", "task_failed", "无可用选题");
      return NextResponse.json({ error: "无可用选题" }, { status: 400 });
    }
    outline = topic.text;
  }

  const controller = new AbortController();
  registerRun(taskId, controller);
  const seriesCtx = await getSeriesContextForTask(task);
  const seriesSection = seriesCtx ? buildSeriesPromptSection(seriesCtx, task.episodeNo) : undefined;
  return createSseStream(async (send) => {
    try {
      await db.task.update({ where: { taskId }, data: { status: "writing" } });
      await logTaskEvent(taskId, "writing", "llm_start", outline.slice(0, 100));
      await pumpScriptStream(
        taskId,
        writeScriptStream({
          outline,
          sourceType: task.sourceType as ComicScript["source"],
          tags,
          seriesSection,
          signal: controller.signal,
        }),
        send,
        { doneLabel: "剧本生成完成" },
      );
    } finally {
      unregisterRun(taskId);
    }
  });
}
