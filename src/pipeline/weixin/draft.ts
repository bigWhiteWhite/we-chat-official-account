import { WECHAT_ERR_INVALID_IP, failWithInvalidIp, withTokenRetry } from "./token";

/** 微信接口原始反馈 */
export interface WeixinFeedback {
  errcode: number;
  errmsg: string;
}

/** 微信接口业务错误：errcode 非 0 时抛出，保留原始反馈供前端展示 */
export class WeixinApiError extends Error {
  feedback: WeixinFeedback;

  constructor(feedback: WeixinFeedback) {
    super(`微信接口错误: errcode=${feedback.errcode} errmsg=${feedback.errmsg}`);
    this.name = "WeixinApiError";
    this.feedback = feedback;
  }
}

/** HTML 转义（正文注入防御） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 剧本中与正文相关的子集（来自 scriptJson） */
export type ArticleScriptLike = {
  title: string;
  theme?: string;
  punchline?: string;
  intro?: string;
  panels: Array<{ scene?: string; dialogue?: string; narration?: string }>;
};

/**
 * 正文 HTML：题材徽章 → 导语 → 每图居中段落 + 图下说明文字（captions 与 urls 下标对齐）。
 * 超 20000 字符抛错（微信正文上限）。
 */
export function buildArticleHtml(
  script: ArticleScriptLike,
  urls: string[],
  captions?: string[],
  intro?: string,
): string {
  const parts: string[] = [];
  const theme = (script.theme ?? "").trim();
  if (theme && theme !== "未命名") {
    parts.push(
      `<p style="text-align:center;margin:0 0 20px;"><span style="display:inline-block;padding:3px 12px;background:#f5f5f5;border-radius:12px;font-size:13px;color:#888;">${escapeHtml(theme)}</span></p>`,
    );
  }
  if (intro && intro.trim()) {
    parts.push(
      `<p style="font-size:15px;line-height:1.8;color:#333;margin:0 0 24px;">${escapeHtml(intro.trim())}</p>`,
    );
  }
  urls.forEach((url, i) => {
    parts.push(
      `<p style="text-align:center;margin:0 0 10px;"><img src="${url}" style="max-width:100%;"/></p>`,
    );
    const caption = (captions?.[i] ?? "").trim();
    if (caption) {
      parts.push(
        `<p style="font-size:14px;line-height:1.7;color:#666;margin:0 0 24px;">${escapeHtml(caption)}</p>`,
      );
    }
  });
  parts.push(
    `<p style="font-size:15px;line-height:1.8;color:#666;margin:24px 0 0;padding-top:20px;border-top:1px solid #eee;">我是修仙小师妹苏软软～这一期的故事就到这里啦！如果喜欢我们的故事，记得关注我们，下期修炼更有趣的奇遇等着你哦！</p>`,
  );
  const html = parts.join("");
  if (html.length > 20000) {
    throw new Error(`正文 HTML ${html.length} 字符超过微信 20000 上限，请减少分图或精简文案`);
  }
  return html;
}

/** 正文 HTML（旧版）：每张图独立居中段落；超 20000 字符抛错（微信正文上限） */
export function buildContentHtml(urls: string[]): string {
  const html = urls
    .map((url) => `<p style="text-align:center;"><img src="${url}" style="max-width:100%;"/></p>`)
    .join("");
  if (html.length > 20000) {
    throw new Error(`正文 HTML ${html.length} 字符超过微信 20000 上限，请减少分图`);
  }
  return html;
}

/** 建公众号草稿（自动化终点 = 草稿箱；人工到后台发表，不调 freepublish）。 */
export async function addDraft(article: {
  title: string;
  author: string;
  content: string;
  thumbMediaId: string;
  digest?: string;
}): Promise<{ mediaId: string; feedback: WeixinFeedback }> {
  return withTokenRetry((token) => doAddDraft(token, article));
}

async function doAddDraft(
  token: string,
  article: {
    title: string;
    author: string;
    content: string;
    thumbMediaId: string;
    digest?: string;
  },
): Promise<{ mediaId: string; feedback: WeixinFeedback }> {
  const res = await fetch(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      articles: [
        {
          title: article.title,
          author: article.author,
          content: article.content,
          digest: article.digest ?? "",
          thumb_media_id: article.thumbMediaId,
          need_open_comment: 0,
          only_fans_can_comment: 0,
        },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json()) as { media_id?: string; errcode?: number; errmsg?: string };
  const feedback: WeixinFeedback = {
    errcode: json.errcode ?? (json.media_id ? 0 : -1),
    errmsg: json.errmsg ?? (json.media_id ? "ok" : "unknown"),
  };
  if (!json.media_id) {
    if (json.errcode === WECHAT_ERR_INVALID_IP) {
      await failWithInvalidIp(json.errmsg);
    }
    throw new WeixinApiError(feedback);
  }
  return { mediaId: json.media_id, feedback };
}
