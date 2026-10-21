import path from "node:path";

import { NextResponse } from "next/server";
import pRetry from "p-retry";
import { z } from "zod";

import { db } from "@/lib/db";
import { getStylePreset } from "@/lib/business-settings";
import { createSseStream } from "@/lib/sse";
import { logTaskEvent } from "@/lib/task-events";
import {
  callImageApi,
  generateCharacterView,
  parseSubjectPromptOverrides,
} from "@/pipeline/artist";
import { buildStylePreviewPrompt } from "@/pipeline/prompts/subjects";
import type { ComicScript } from "@/pipeline/schema";
import { sceneName } from "@/pipeline/schema";
import { parseTaskReferences, stylePresetFor, type TaskReferences } from "@/pipeline/subjects";

const Body = z.object({
  kind: z.enum(["character", "style"]),
  index: z.number().int().min(0).optional(),
  preset: z.string().max(300).optional(),
});

function parseScript(json: string | null | undefined): ComicScript | null {
  if (!json) return null;
  try {
    const obj = JSON.parse(json) as ComicScript;
    return obj && Array.isArray(obj.panels) ? obj : null;
  } catch {
    return null;
  }
}

/**
 * SSE 单主体重新生成：仅限未绑定资产的项（绑定资产请在资产库内修改）；覆盖写确定性路径。
 * 画风支持在确认主体前单独生成（无需 referencePathsJson，从剧本构建骨架 refs 并持久化）。
 */
export async function POST(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const task = await db.task.findUnique({ where: { taskId } });
  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  const parsedBody = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.message }, { status: 400 });
  }
  const kind = parsedBody.data.kind;

  let refs: TaskReferences;
  if (task.referencePathsJson) {
    const parsed = parseTaskReferences(task.referencePathsJson);
    if (parsed.kind !== "new") {
      return NextResponse.json({ error: "旧格式任务不支持单独重生成主体" }, { status: 400 });
    }
    refs = parsed.refs;
  } else if (kind === "style") {
    const script = parseScript(task.scriptJson);
    if (!script || script.panels.length === 0) {
      return NextResponse.json({ error: "缺少剧本数据，无法生成画风样图" }, { status: 400 });
    }
    refs = {
      style: { assetId: null, preset: "", image: null },
      scene: { assetId: null, name: sceneName(script), image: null },
      characters: [],
    };
  } else {
    return NextResponse.json({ error: "缺少主体数据，请先确认主体" }, { status: 400 });
  }

  const outDir = path.join("data", "images", taskId, "subjects");
  const promptOverrides = parseSubjectPromptOverrides(task.subjectPromptOverridesJson);

  if (kind === "style") {
    if (refs.style?.assetId) {
      return NextResponse.json(
        { error: "画风已绑定主体库资产，请在资产库中操作" },
        { status: 400 },
      );
    }
    const preset = parsedBody.data.preset?.trim() || refs.style?.preset?.trim() || getStylePreset();
    const outPath = path.join(outDir, "style0.png");
    return createSseStream(async (send) => {
      send({ type: "stage", message: `正在生成画风样图「${preset}」…` });
      try {
        const img = await pRetry(
          () => callImageApi(promptOverrides.style ?? buildStylePreviewPrompt(preset), outPath),
          {
            retries: 1,
          },
        );
        refs.style = { assetId: null, preset, image: img.path };
        await db.task.update({
          where: { taskId },
          data: { referencePathsJson: JSON.stringify(refs) },
        });
        await logTaskEvent(taskId, "subjects", "subject_regenerated", `画风：${preset}`, {
          kind: "style",
        });
        send({
          type: "subject",
          kind: "style",
          source: "generated",
          name: preset,
          image: img.path,
        });
        send({ type: "done" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await logTaskEvent(taskId, "subjects", "subject_regenerated_failed", message, {
          kind: "style",
        });
        send({ type: "error", message });
      }
    });
  }

  const preset = stylePresetFor(refs, getStylePreset());

  const index = parsedBody.data.index ?? 0;
  const target = refs.characters[index];
  if (!target) {
    return NextResponse.json({ error: "角色不存在" }, { status: 404 });
  }
  const outPath = path.join(outDir, `c${index}.png`);
  if (target.assetId) {
    return NextResponse.json({ error: "已绑定主体库资产，请在资产库中操作" }, { status: 400 });
  }

  return createSseStream(async (send) => {
    send({ type: "stage", message: `正在重新生成「${target.name}」…` });
    try {
      const img = await pRetry(
        () =>
          generateCharacterView(target.name, target.appearance ?? "", preset, outPath, undefined, {
            promptOverride: promptOverrides.characters?.[target.name],
          }),
        { retries: 1 },
      );
      target.image = img.path;
      await db.task.update({
        where: { taskId },
        data: { referencePathsJson: JSON.stringify(refs) },
      });
      await logTaskEvent(taskId, "subjects", "subject_regenerated", target.name, { kind, index });
      send({
        type: "subject",
        kind,
        index,
        source: "generated",
        name: target.name,
        image: img.path,
      });
      send({ type: "done" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logTaskEvent(taskId, "subjects", "subject_regenerated_failed", message, {
        kind,
        index,
      });
      send({ type: "error", message });
    }
  });
}
