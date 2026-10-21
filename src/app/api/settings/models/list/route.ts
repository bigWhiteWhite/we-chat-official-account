import { NextRequest, NextResponse } from "next/server";

import { listModels } from "@/model-manager";
import type { ModelBizType } from "@/model-manager";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { baseUrl: string; apiKey?: string; biz?: ModelBizType };
    if (!body?.baseUrl) {
      return NextResponse.json({ error: "缺少 baseUrl" }, { status: 400 });
    }
    // listModels 直接返回 string[]（非 {models}）；biz 让后端在 Key 留空时复用该域已存 key
    const models = await listModels({
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      biz: body.biz,
    });
    return NextResponse.json({ models });
  } catch (err) {
    // 拉取失败不致命：前端退回手输
    return NextResponse.json(
      { models: [], error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
