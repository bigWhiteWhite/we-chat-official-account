import { NextResponse } from "next/server";

import { z } from "zod";

import { db } from "@/lib/db";

const Body = z.object({
  action: z.enum(["pass", "regenerate", "reject"]),
  note: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { action, note } = parsed.data;
  await db.task.update({
    where: { taskId },
    data: {
      reviewResult: action,
      reviewNote: note ?? "",
      // 通过 → review_passed（审核通过后等待发布）；弃稿即终态；重生成回到生图阶段（完成后回 reviewing）
      status:
        action === "reject" ? "rejected" : action === "regenerate" ? "drawing" : "review_passed",
    },
  });
  await db.reviewLog.create({ data: { taskId, action } });
  return NextResponse.json({ ok: true });
}
