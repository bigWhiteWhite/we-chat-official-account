import { NextRequest, NextResponse } from "next/server";

import {
  buildAppSettingsPayload,
  saveAppSettingsPayload,
  type AppSettingsSavePayload,
} from "@/lib/settings-payload";

export async function GET() {
  try {
    return NextResponse.json(await buildAppSettingsPayload());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      payload: AppSettingsSavePayload;
    };
    if (!body.payload?.domains || !body.payload?.business) {
      return NextResponse.json(
        { error: "payload.domains 或 payload.business 缺失" },
        { status: 400 },
      );
    }
    await saveAppSettingsPayload(body.payload);
    return NextResponse.json(await buildAppSettingsPayload());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
