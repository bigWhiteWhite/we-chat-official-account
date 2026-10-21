import { NextRequest, NextResponse } from "next/server";

import { testModelConnection } from "@/model-manager";
import type { TestModelParams } from "@/model-manager";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as TestModelParams;
    if (!body?.biz || !body?.modelId || !body?.baseUrl) {
      return NextResponse.json({ error: "缺少 biz、modelId 或 baseUrl" }, { status: 400 });
    }
    const result = await testModelConnection(body);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
