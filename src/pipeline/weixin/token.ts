import { db } from "@/lib/db";
import { getAppId, getAppSecret } from "@/lib/business-settings";

const API = "https://api.weixin.qq.com";

/** 微信 40164：当前出口 IP 不在公众号 IP 白名单。 */
export const WECHAT_ERR_INVALID_IP = 40164;

/** 从 40164 的 errmsg 中提取当前出口 IP（errmsg 形如 "invalid ip 1.2.3.4, not in whitelist rid: …"）。 */
export function extractInvalidIp(errmsg?: string): string | null {
  if (!errmsg) return null;
  const m = errmsg.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
  return m ? m[1] : null;
}

/** 40164 专用错误：当前出口 IP 未加白名单（或跨出口 IP 复用了旧 token）。 */
export class WeixinInvalidIpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeixinInvalidIpError";
  }
}

/** 使缓存的 token 失效（如出口 IP 变化命中 40164 后，避免继续复用旧 token）。 */
export async function invalidateAccessToken(): Promise<void> {
  await db.tokenCache.deleteMany({ where: { key: getAppId() } }).catch(() => {});
}

/** 微信接口返回 40164 时：失效缓存 token 并抛出携带当前出口 IP 的错误，便于直接加入白名单。 */
export async function failWithInvalidIp(errmsg?: string): Promise<never> {
  await invalidateAccessToken();
  const ip = extractInvalidIp(errmsg);
  throw new WeixinInvalidIpError(
    `微信 40164 invalid ip${ip ? `（当前出口 IP：${ip}）` : ""}：请将该 IP 加入公众号 IP 白名单后重试`,
  );
}

/** 直接向微信申请新 token 并写入缓存。 */
async function fetchFreshToken(): Promise<string> {
  const appId = getAppId();
  const appSecret = getAppSecret();
  if (!appId || !appSecret) {
    throw new Error("微信 APPID/APPSECRET 未配置，请到「设置」页填写");
  }
  const url = `${API}/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
  };
  if (!json.access_token) {
    if (json.errcode === 40001) {
      throw new Error("微信 40001 invalid credential：请检查 APPSECRET 是否正确");
    }
    if (json.errcode === WECHAT_ERR_INVALID_IP) {
      return failWithInvalidIp(json.errmsg);
    }
    throw new Error(`获取 access_token 失败: ${json.errcode} ${json.errmsg ?? ""}`);
  }
  const expiresAt = new Date(Date.now() + (json.expires_in ?? 7200) * 1000);
  await db.tokenCache.upsert({
    where: { key: appId },
    create: { key: appId, accessToken: json.access_token, expiresAt },
    update: { accessToken: json.access_token, expiresAt },
  });
  return json.access_token;
}

/** 获取公众号 access_token：优先读 token_cache（剩余 < 5 分钟视为过期）。 */
export async function getAccessToken(): Promise<string> {
  const cached = await db.tokenCache.findUnique({ where: { key: getAppId() } });
  if (cached && cached.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return cached.accessToken;
  }
  return fetchFreshToken();
}

/** 强制失效缓存并重新获取新 token（跨出口 IP 命中 40164 后的自愈路径）。 */
export async function refreshAccessToken(): Promise<string> {
  await invalidateAccessToken();
  return fetchFreshToken();
}

/**
 * 带 40164 自愈的调用包装：首次用现有（可能缓存的）token；若命中 40164
 * （典型：出口 IP 变化后复用了旧 token），自动失效缓存、重取 token 并重试一次；
 * 仍失败则抛出带当前出口 IP 的 WeixinInvalidIpError。
 */
export async function withTokenRetry<T>(op: (token: string) => Promise<T>): Promise<T> {
  let token = await getAccessToken();
  try {
    return await op(token);
  } catch (err) {
    if (!(err instanceof WeixinInvalidIpError)) throw err;
    token = await refreshAccessToken();
    return op(token);
  }
}
