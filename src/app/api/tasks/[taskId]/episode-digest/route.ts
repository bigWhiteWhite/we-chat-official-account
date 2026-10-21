import { NextResponse } from "next/server";

import { z } from "zod";

import { db } from "@/lib/db";

const Body = z.object({
  digest: z.string().min(1).max(120),
});

/** 手动编辑合集剧集的"本集简介"（发布后自动生成的简介可覆写） */
export async function PATCH(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const task = await db.task.findUnique({ where: { taskId } });
  if (!task) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await db.task.update({
    where: { taskId },
    data: { episodeDigest: parsed.data.digest.trim() },
  });
  return NextResponse.json({ ok: true });
}
