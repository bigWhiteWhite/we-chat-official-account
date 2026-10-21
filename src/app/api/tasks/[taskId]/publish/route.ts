import { NextResponse } from "next/server";

import { publishTask } from "@/pipeline/publisher";
import { WeixinApiError } from "@/pipeline/weixin/draft";

export async function POST(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  try {
    const r = await publishTask(taskId);
    return NextResponse.json(r);
  } catch (err) {
    const feedback = err instanceof WeixinApiError ? err.feedback : undefined;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), feedback },
      { status: 500 },
    );
  }
}
