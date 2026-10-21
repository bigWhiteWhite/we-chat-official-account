import { NextResponse } from "next/server";

import { z } from "zod";

import { db } from "@/lib/db";
import { pumpScriptStream } from "@/lib/script-stream";
import { createSseStream } from "@/lib/sse";
import { logTaskEvent } from "@/lib/task-events";
import type { ComicScript } from "@/pipeline/schema";
import { writeScriptStream } from "@/pipeline/writer";

const Body = z.object({ message: z.string().min(1).max(2000) });

/** SSE：按用户意见整份重写剧本（Q3=A）；覆盖 scriptJson+title，状态 script_ready。 */
export async function POST(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const task = await db.task.findUnique({ where: { taskId } });
  if (!task) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!task.scriptJson) {
    return NextResponse.json({ error: "任务暂无剧本，无法修订" }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const currentScript = JSON.parse(task.scriptJson) as ComicScript;

  return createSseStream(async (send) => {
    await db.task.update({ where: { taskId }, data: { status: "writing" } });
    await logTaskEvent(taskId, "writing", "revise_start", parsed.data.message.slice(0, 200));
    await pumpScriptStream(
      taskId,
      writeScriptStream({
        outline: task.outlineText ?? "",
        sourceType: task.sourceType as ComicScript["source"],
        mode: "revise",
        currentScript,
        message: parsed.data.message,
      }),
      send,
      { doneLabel: "剧本修订完成" },
    );
  });
}
