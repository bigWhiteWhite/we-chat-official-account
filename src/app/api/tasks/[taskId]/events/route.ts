import { NextResponse } from "next/server";

import { db } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const events = await db.taskEvent.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ events });
}
