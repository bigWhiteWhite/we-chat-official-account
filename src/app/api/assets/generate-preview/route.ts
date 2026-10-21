import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import pRetry from "p-retry";
import { z } from "zod";

import { getStylePreset } from "@/lib/business-settings";
import { callImageApi, generateCharacterView, generateSceneView } from "@/pipeline/artist";

const Body = z.object({
  type: z.enum(["character", "scene", "style"]),
  name: z.string().min(1).max(50),
  imagePrompt: z.string().max(500).optional(),
  stylePreset: z.string().max(300).optional(),
  size: z.string().optional(),
});

/** 资产参考图生成预览（无状态）：文生图后以 base64 返回，不落库；前端确认保存时随创建/更新接口写入 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { type, name, imagePrompt, stylePreset, size } = parsed.data;
  const preset = stylePreset?.trim() || getStylePreset();
  const promptText = imagePrompt?.trim() ?? "";
  const tmpPath = path.join("data", "tmp", `${randomUUID()}.png`);
  try {
    await pRetry(
      () => {
        if (type === "character") {
          return generateCharacterView(name, promptText, preset, tmpPath, size);
        }
        if (type === "scene") {
          return generateSceneView(promptText || name, preset, tmpPath, size);
        }
        return callImageApi(
          [
            `画风：${preset}，中文漫画。`,
            "风格参考样图：一张展示该画风视觉特征的示例漫画画面（简单场景与一个示例角色即可，无需文字），用作风格参考。",
          ].join("\n"),
          tmpPath,
          size,
        );
      },
      { retries: 1 },
    );
    const buf = await readFile(tmpPath);
    return NextResponse.json({ imageBase64: buf.toString("base64"), mimeType: "image/png" });
  } finally {
    await rm(tmpPath, { force: true }).catch(() => {});
  }
}
