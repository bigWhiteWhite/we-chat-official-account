import { NextResponse } from "next/server";

import { z } from "zod";

import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

const PatchBody = z.object({
  name: z.string().trim().min(1).max(20).optional(),
  description: z.string().max(2000).optional(),
});

/** 更新标签：改名需保持唯一；已有任务/合集绑定时改名即刻影响后续生成（历史剧本不回改） */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const tag = await db.tag.findUnique({ where: { id } });
  if (!tag) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) {
    if (parsed.data.name !== tag.name) {
      const dup = await db.tag.findUnique({ where: { name: parsed.data.name } });
      if (dup) {
        return NextResponse.json({ error: `标签「${parsed.data.name}」已存在` }, { status: 409 });
      }
    }
    data.name = parsed.data.name;
  }
  if (parsed.data.description !== undefined) {
    data.description = parsed.data.description.trim();
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  }
  const updated = await db.tag.update({ where: { id }, data });
  return NextResponse.json({ tag: updated });
}

/** 删除标签：级联解绑全部任务/合集（TaskTag、SeriesTag 行随之删除，任务与合集本身不受影响） */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const tag = await db.tag.findUnique({ where: { id } });
  if (!tag) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await db.tag.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
