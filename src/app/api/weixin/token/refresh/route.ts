import { NextResponse } from "next/server";

import { refreshAccessToken } from "@/pipeline/weixin/token";

/** 手动刷新微信 access_token：失效缓存后重新获取（出口 IP 变化加入白名单后的自愈入口）。 */
export async function POST() {
  try {
    await refreshAccessToken();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
