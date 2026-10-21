import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

const DATA_DIR = path.resolve(process.cwd(), "data");
const IMAGE_ROOTS: Record<"images" | "assets", string> = {
  images: path.join(DATA_DIR, "images"),
  assets: path.join(DATA_DIR, "assets"),
};

/**
 * 本地图片静态服务：?path= 相对 data/images 或 data/assets 的白名单路径，
 * 兼容 "data/images/..."、"data/assets/..." 前缀与裸相对路径；
 * 归一化后必须落在对应根目录内，防目录穿越。
 */
export async function GET(req: Request) {
  const rel = (new URL(req.url).searchParams.get("path") ?? "").replace(/\\/g, "/");
  const kind: "images" | "assets" =
    rel.startsWith("data/assets/") || rel.startsWith("assets/") ? "assets" : "images";
  const bare = rel.replace(/^data\/(images|assets)\//, "").replace(/^(images|assets)\//, "");
  const root = IMAGE_ROOTS[kind];
  const abs = path.resolve(root, bare);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    return NextResponse.json({ error: "非法路径" }, { status: 400 });
  }
  try {
    const s = await stat(abs);
    if (!s.isFile()) {
      throw new Error("not a file");
    }
    const lastModified = s.mtime.toUTCString();
    const ifModifiedSince = req.headers.get("if-modified-since");
    if (ifModifiedSince) {
      const since = new Date(ifModifiedSince).getTime();
      // mtime 按秒精度比较，与 Last-Modified 的精度对齐
      if (!Number.isNaN(since) && since >= Math.floor(s.mtimeMs / 1000) * 1000) {
        return new NextResponse(null, {
          status: 304,
          headers: { "Last-Modified": lastModified, "Cache-Control": "no-cache" },
        });
      }
    }
    const buf = await readFile(abs);
    const type = abs.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": type, "Cache-Control": "no-cache", "Last-Modified": lastModified },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
