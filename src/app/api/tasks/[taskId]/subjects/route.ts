import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { FeedRecorder } from "@/lib/feed-recorder";
import { createSseStream } from "@/lib/sse";
import { logTaskEvent } from "@/lib/task-events";
import { parseSubjectPromptOverrides } from "@/pipeline/artist";
import { resolveSubjects } from "@/pipeline/subject-bind";
import type { ComicScript } from "@/pipeline/schema";
import type { SubjectBindings } from "@/pipeline/subjects";

const Binding = z.object({
  name: z.string(),
  assetId: z.string().nullable(),
  variantId: z.string().max(64).nullable().optional(),
});
const Body = z.object({
  bindings: z.object({
    style: z
      .object({ assetId: z.string().nullable(), preset: z.string().optional() })
      .nullable()
      .optional(),
    scene: Binding,
    characters: z.array(Binding),
  }),
});

const VALID_STATUSES = ["script_ready", "subjects_ready", "drawing", "reviewing", "review_passed"];

/** SSE 确认主体：绑定项复用资产图、未绑定项文生图 → 写 referencePathsJson/subjectBindingsJson，状态置 subjects_ready */
export async function POST(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const task = await db.task.findUnique({ where: { taskId } });
  if (!task) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!task.scriptJson) {
    return NextResponse.json({ error: "任务暂无剧本" }, { status: 400 });
  }
  if (!VALID_STATUSES.includes(task.status)) {
    return NextResponse.json({ error: `当前状态 ${task.status} 不可确认主体` }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const script = JSON.parse(task.scriptJson) as ComicScript;
  const raw = parsed.data.bindings;
  const bindings: SubjectBindings = {
    scene: { name: raw.scene.name, assetId: raw.scene.assetId },
    characters: raw.characters.map((c) => ({
      name: c.name,
      assetId: c.assetId,
      variantId: c.variantId ?? null,
    })),
  };
  if (raw.style) bindings.style = { assetId: raw.style.assetId, preset: raw.style.preset };

  // 过滤资产库中不存在的 assetId（防御前端篡改）
  const ids = [
    bindings.scene.assetId,
    ...bindings.characters.map((c) => c.assetId),
    bindings.style?.assetId ?? null,
  ].filter((v): v is string => v !== null);
  if (ids.length > 0) {
    const found = await db.asset.findMany({ where: { id: { in: ids } } });
    const valid = new Set(found.map((a) => a.id));
    if (bindings.scene.assetId && !valid.has(bindings.scene.assetId)) {
      bindings.scene.assetId = null;
    }
    for (const c of bindings.characters) {
      if (c.assetId && !valid.has(c.assetId)) c.assetId = null;
    }
    if (bindings.style?.assetId && !valid.has(bindings.style.assetId)) {
      bindings.style.assetId = null;
    }
  }

  return createSseStream(async (send) => {
    const recorder = new FeedRecorder();
    const trackSend = (ev: unknown): void => {
      const e = ev as { type?: string; [key: string]: unknown };
      if (e && typeof e.type === "string" && e.type !== "subject")
        recorder.push({ ...e, type: e.type });
      send(ev);
    };
    trackSend({ type: "stage", message: "正在解析主体绑定…" });
    await logTaskEvent(taskId, "subjects", "subjects_start", JSON.stringify(bindings));
    try {
      const refs = await resolveSubjects(
        taskId,
        script,
        bindings,
        trackSend,
        parseSubjectPromptOverrides(task.subjectPromptOverridesJson),
      );
      await db.task.update({
        where: { taskId },
        data: {
          referencePathsJson: JSON.stringify(refs),
          subjectBindingsJson: JSON.stringify(bindings),
          status: "subjects_ready",
          error: null,
        },
      });
      await logTaskEvent(taskId, "subjects", "subjects_done", "主体确认完成");
      recorder.markDone("主体确认完成");
      await recorder.save(taskId, "subjects");
      trackSend({ type: "done", status: "subjects_ready" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.task.update({ where: { taskId }, data: { error: message } });
      await logTaskEvent(taskId, "subjects", "subjects_failed", message);
      recorder.push({ type: "error", message });
      await recorder.save(taskId, "subjects");
      send({ type: "error", message });
    }
  });
}
