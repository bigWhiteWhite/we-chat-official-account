import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { hasAnyRun } from "@/lib/inflight";
import {
  normalizeSlashes,
  parsePanelVersion,
  resolvePanelVersionFile,
  sortPanelVersions,
  type PanelVersionEntry,
} from "@/pipeline/panel-versions";
import { savePanelImage } from "@/pipeline/panels";
import type { ComicScript } from "@/pipeline/schema";

const SELECT_BODY = z.object({ path: z.string().min(1) });

function taskImageDir(taskId: string): string {
  return path.join("data", "images", taskId);
}

/** 列出某格在磁盘上的全部版本（含旧格式无后缀初始版本），DB 当前指向的版本标记 isActive */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ taskId: string; index: string }> },
) {
  const { taskId, index: rawIndex } = await params;
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "格序号无效" }, { status: 400 });
  }
  const task = await db.task.findUnique({ where: { taskId } });
  if (!task) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const panelCount = task.scriptJson
    ? (JSON.parse(task.scriptJson) as ComicScript).panels.length
    : 0;
  if (index >= panelCount) {
    return NextResponse.json({ error: "格序号越界" }, { status: 400 });
  }
  const dir = taskImageDir(taskId);
  const names = await readdir(dir).catch(() => [] as string[]);
  const current = task.imagePathsJson
    ? ((JSON.parse(task.imagePathsJson) as (string | null)[])[index] ?? "")
    : "";
  const currentNorm = normalizeSlashes(current);
  const entries: PanelVersionEntry[] = [];
  for (const name of names) {
    const version = parsePanelVersion(index, name);
    if (version === null) continue;
    try {
      const s = await stat(path.join(dir, name));
      entries.push({ version, fileName: name, mtimeMs: s.mtimeMs });
    } catch {
      // 文件可能正被删除，跳过
    }
  }
  const versions = sortPanelVersions(entries).map((e) => {
    const p = path.join(dir, e.fileName);
    return {
      version: e.version,
      fileName: e.fileName,
      path: p,
      updatedAt: new Date(e.mtimeMs).toISOString(),
      isActive: normalizeSlashes(p) === currentNorm,
    };
  });
  return NextResponse.json({ versions });
}

/**
 * 切换某格当前版本：只移动 DB 指针（imagePathsJson[index]），磁盘全部版本保留；
 * 与 savePanelImage 同一串行链，防止与重生成并发写 imagePathsJson 互相覆盖。
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ taskId: string; index: string }> },
) {
  const { taskId, index: rawIndex } = await params;
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "格序号无效" }, { status: 400 });
  }
  const task = await db.task.findUnique({ where: { taskId } });
  if (!task) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!task.scriptJson) {
    return NextResponse.json({ error: "任务暂无剧本" }, { status: 400 });
  }
  const script = JSON.parse(task.scriptJson) as ComicScript;
  if (index >= script.panels.length) {
    return NextResponse.json({ error: "格序号越界" }, { status: 400 });
  }
  if (hasAnyRun(taskId)) {
    return NextResponse.json({ error: "该任务有生成任务进行中，请稍候" }, { status: 409 });
  }
  const body = SELECT_BODY.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "缺少版本路径" }, { status: 400 });
  }
  const dir = taskImageDir(taskId);
  const fileName = resolvePanelVersionFile(dir, index, body.data.path);
  if (!fileName) {
    return NextResponse.json({ error: "不是该格的合法版本文件" }, { status: 400 });
  }
  try {
    const s = await stat(path.join(dir, fileName));
    if (!s.isFile()) throw new Error("not a file");
  } catch {
    return NextResponse.json({ error: "版本文件不存在" }, { status: 404 });
  }
  const canonical = path.join(dir, fileName);
  const { status } = await savePanelImage(taskId, index, canonical, script.panels.length);
  return NextResponse.json({ ok: true, path: canonical, status });
}
