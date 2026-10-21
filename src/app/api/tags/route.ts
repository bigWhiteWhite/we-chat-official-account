import { NextResponse } from "next/server";

import { z } from "zod";

import { db } from "@/lib/db";

/** 标签列表（按名称升序），附任务/合集使用数供管理页展示 */
export async function GET() {
  const tags = await db.tag.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { tasks: true, series: true } } },
  });
  return NextResponse.json({
    tags: tags.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      taskCount: t._count.tasks,
      seriesCount: t._count.series,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
  });
}

const CreateBody = z.object({
  name: z.string().trim().min(1).max(20),
  description: z.string().max(2000).optional(),
});

/** 新建标签：名称唯一，重名返回中文提示 */
export async function POST(req: Request) {
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const exists = await db.tag.findUnique({ where: { name: parsed.data.name } });
  if (exists) {
    return NextResponse.json({ error: `标签「${parsed.data.name}」已存在` }, { status: 409 });
  }
  const tag = await db.tag.create({
    data: { name: parsed.data.name, description: parsed.data.description?.trim() ?? "" },
  });
  return NextResponse.json({ tag });
}

const BulkDeleteBody = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
});

/** 批量删除标签：同单条删除，级联解绑全部任务/合集 */
export async function DELETE(req: Request) {
  const parsed = BulkDeleteBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const ids = [...new Set(parsed.data.ids)];
  const r = await db.tag.deleteMany({ where: { id: { in: ids } } });
  return NextResponse.json({ deleted: r.count });
}
