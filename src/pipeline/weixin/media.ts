import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import pLimit from "p-limit";
import sharp from "sharp";

import { WECHAT_ERR_INVALID_IP, failWithInvalidIp, withTokenRetry } from "./token";

const API = "https://api.weixin.qq.com";
const MAX_BYTES = 10 * 1024 * 1024;

/** 压缩到 ≤10MB（JPEG 质量 90 起步逐级降）；未超限原样返回 */
export async function compressForWeixin(p: string): Promise<string> {
  const s = await stat(p);
  if (s.size <= MAX_BYTES) return p;
  let quality = 90;
  while (quality >= 40) {
    const out = path.join(
      await mkdtemp(path.join(tmpdir(), "wx-")),
      `${path.basename(p)}.${quality}.jpg`,
    );
    const buf = await sharp(p).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (buf.byteLength <= MAX_BYTES) {
      await writeFile(out, buf);
      return out;
    }
    quality -= 10;
  }
  throw new Error(`图片压缩后仍超过 10MB: ${p}`);
}

type UploadResult = { media_id?: string; url?: string };

async function upload(
  token: string,
  p: string,
  endpoint: string,
  extraQuery?: string,
): Promise<UploadResult> {
  const buf = await readFile(p);
  const form = new FormData();
  form.append("media", new Blob([buf]), path.basename(p));
  const qs = [extraQuery, `access_token=${token}`].filter(Boolean).join("&");
  const res = await fetch(`${API}/cgi-bin/${endpoint}?${qs}`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json()) as UploadResult & { errcode?: number; errmsg?: string };
  if (json.errcode) {
    if (json.errcode === WECHAT_ERR_INVALID_IP) {
      return failWithInvalidIp(json.errmsg);
    }
    throw new Error(`微信 ${endpoint} 失败: ${json.errcode} ${json.errmsg ?? ""}`);
  }
  return json;
}

/** 封面 → 永久素材 media_id（material/add_material?type=image） */
export async function uploadPermanentImage(p: string): Promise<string> {
  const r = await withTokenRetry((token) =>
    upload(token, p, "material/add_material", "type=image"),
  );
  if (!r.media_id) throw new Error("微信 material/add_material 未返回 media_id");
  return r.media_id;
}

/** 正文图片 → 微信 url（media/uploadimg） */
export async function uploadContentImage(p: string): Promise<string> {
  const r = await withTokenRetry((token) => upload(token, p, "media/uploadimg"));
  if (!r.url) throw new Error("微信 media/uploadimg 未返回 url");
  return r.url;
}

/** 批量上传正文图：并发 3，每张间隔 0.3s 控频 */
export async function uploadContentImages(paths: string[]): Promise<string[]> {
  const limit = pLimit(3);
  return Promise.all(
    paths.map((p, i) =>
      limit(async () => {
        if (i > 0) await new Promise((r) => setTimeout(r, 300));
        const src = await compressForWeixin(p);
        return uploadContentImage(src);
      }),
    ),
  );
}
