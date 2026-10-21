import { NextResponse } from "next/server";

import { z } from "zod";

import { reorderSeries } from "@/lib/series";

const Body = z.object({ order: z.array(z.string().min(1)).min(1).max(1000) });

/** 合集拖拽排序：body.order 为新的全局顺序（合集 id 数组），按 0..n 重写 sortOrder */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  try {
    await reorderSeries(parsed.data.order);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
