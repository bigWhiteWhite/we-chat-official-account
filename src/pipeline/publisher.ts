import { getAuthor, getNarrationInImage } from "@/lib/business-settings";
import { db } from "@/lib/db";
import { logTaskEvent } from "@/lib/task-events";

import { generateEpisodeDigest } from "./episode-digest";
import {
  addDraft,
  buildArticleHtml,
  type ArticleScriptLike,
  WeixinApiError,
  WeixinFeedback,
} from "./weixin/draft";
import { compressForWeixin, uploadContentImages, uploadPermanentImage } from "./weixin/media";
import { WeixinInvalidIpError, refreshAccessToken } from "./weixin/token";

/**
 * 发布管线：
 * 封面传永久素材 + 正文图按序 uploadimg → 建微信草稿 → 落 publish_records。
 * 终点为草稿箱，人工到公众号后台发表。
 * 内容取默认：全部图片按序 + 剧本标题/作者/图片图注。
 * 返回微信原始反馈（errcode/errmsg），前端按反馈决定是否展示失败卡。
 */
export async function publishTask(taskId: string): Promise<{
  draftMediaId: string;
  feedback: WeixinFeedback;
  title: string;
}> {
  const task = await db.task.findUniqueOrThrow({ where: { taskId } });
  if (task.draftMediaId) {
    throw new Error(`任务已创建过草稿（${task.draftMediaId}），不可重复发布`);
  }
  if (!task.scriptJson || !task.imagePathsJson) {
    throw new Error("任务缺少剧本或图片，无法发布");
  }
  const script = JSON.parse(task.scriptJson) as ArticleScriptLike;
  const imagePaths = JSON.parse(task.imagePathsJson) as (string | null)[];
  if (imagePaths.length === 0) {
    throw new Error("任务无图片，无法发布");
  }

  // 正文顺序：全部图片按序
  const bodyOrder = imagePaths.map((_, i) => i).filter((i) => imagePaths[i] != null);

  // 旁白：NARRATION_IN_IMAGE 开启时已渲染进画面，图下不重复输出（避免影响原创性检查）；
  // 未开启时旁白以图下说明形式随正文发布（"无"视为无旁白）
  const captions = getNarrationInImage()
    ? bodyOrder.map(() => "")
    : bodyOrder.map((i) => {
        const n = (script.panels[i]?.narration ?? "").trim();
        return n === "无" ? "" : n;
      });

  if (bodyOrder.length === 0) throw new Error("任务无可用图片，无法发布");
  const bodyPaths = bodyOrder.map((i) => imagePaths[i] as string);

  // 封面：取首张正文图
  const coverPath = bodyPaths[0];

  const title = (script.title || "").slice(0, 64);
  const digest = "";
  const author = (getAuthor() || "").slice(0, 8);

  await db.task.update({ where: { taskId }, data: { status: "publishing" } });
  await logTaskEvent(taskId, "publishing", "publish_start", title);

  let draftMediaId!: string;
  let feedback!: WeixinFeedback;
  async function tryPublish(): Promise<void> {
    try {
      const coverCompressed = await compressForWeixin(coverPath);
      const thumbMediaId = await uploadPermanentImage(coverCompressed);
      const urls = await uploadContentImages(bodyPaths);
      const content = buildArticleHtml(script, urls, captions, script.intro);
      const r = await addDraft({ title, author, content, thumbMediaId, digest });
      draftMediaId = r.mediaId;
      feedback = r.feedback;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.task.updateMany({
        where: { taskId, status: { not: "stopped" } },
        data: { status: "failed", error: `发布失败: ${message}` },
      });
      await logTaskEvent(
        taskId,
        "publishing",
        "publish_failed",
        message,
        err instanceof WeixinApiError ? err.feedback : undefined,
      );
      throw err;
    }
  }
  try {
    await tryPublish();
  } catch (err) {
    if (err instanceof WeixinInvalidIpError) {
      await refreshAccessToken();
      await tryPublish();
    }
    throw err;
  }

  await db.publishRecord.create({
    data: { taskId, draftMediaId, title, source: task.sourceType },
  });
  await db.task.update({
    where: { taskId },
    data: { status: "done", draftMediaId },
  });
  await logTaskEvent(taskId, "publishing", "publish_done", draftMediaId, feedback);
  // 合集剧集：后台异步生成"本集简介"，供后续剧集前情回顾使用（不阻塞发布响应）
  if (task.seriesId) void generateEpisodeDigest(taskId);
  return { draftMediaId, feedback, title };
}
