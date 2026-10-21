import { db } from "@/lib/db";

import type { ComicScript } from "./schema";

/** 删格：按下标同步删除 scriptJson.panels 与 imagePathsJson；越界抛错。删格不移名（孤儿文件无害）。 */
export function removePanelAt(
  scriptJson: string,
  imagePathsJson: string | null,
  index: number,
): { scriptJson: string; imagePathsJson: string | null } {
  const script = JSON.parse(scriptJson) as ComicScript;
  if (!Number.isInteger(index) || index < 0 || index >= script.panels.length) {
    throw new Error(`格序号越界: ${index}`);
  }
  const panels = script.panels.filter((_, i) => i !== index);
  let imagePaths: string | null = null;
  if (imagePathsJson) {
    const arr = JSON.parse(imagePathsJson) as (string | null)[];
    imagePaths = JSON.stringify(arr.filter((_, i) => i !== index));
  }
  return { scriptJson: JSON.stringify({ ...script, panels }), imagePathsJson: imagePaths };
}

/** 替换指定下标的分格图（重生成覆盖）；下标越界抛错。 */
export function replacePanelImage(
  imagePathsJson: string | null,
  index: number,
  path: string,
): string {
  const arr: (string | null)[] = imagePathsJson
    ? (JSON.parse(imagePathsJson) as (string | null)[])
    : [];
  if (!Number.isInteger(index) || index < 0 || index >= arr.length) {
    throw new Error(`格序号越界: ${index}`);
  }
  arr[index] = path;
  return JSON.stringify(arr);
}

/** 格口重排：按下标把 panels 从 from 移到 to，imagePaths 同步移动保持对齐。 */
export function reorderPanels(
  scriptJson: string,
  imagePathsJson: string | null,
  from: number,
  to: number,
): { scriptJson: string; imagePathsJson: string | null } {
  const script = JSON.parse(scriptJson) as ComicScript;
  const len = script.panels.length;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    from >= len ||
    to < 0 ||
    to >= len
  ) {
    throw new Error(`格序号越界: ${from} -> ${to}（共 ${len} 格）`);
  }
  if (from === to) return { scriptJson, imagePathsJson };
  const panels = [...script.panels];
  const [moved] = panels.splice(from, 1);
  panels.splice(to, 0, moved);
  let nextImagePathsJson: string | null = imagePathsJson;
  if (imagePathsJson) {
    const arr = JSON.parse(imagePathsJson) as (string | null)[];
    if (arr.length === len) {
      const [movedImg] = arr.splice(from, 1);
      arr.splice(to, 0, movedImg);
      nextImagePathsJson = JSON.stringify(arr);
    }
  }
  return { scriptJson: JSON.stringify({ ...script, panels }), imagePathsJson: nextImagePathsJson };
}

/** 进程内串行链：多格并行重生成都会回写 imagePathsJson，串行化读-改-写防止互相覆盖 */
let imageWriteChain: Promise<unknown> = Promise.resolve();

/**
 * 单格图片落库：串行重读最新 imagePathsJson 后写入指定下标，避免多格并行完成时互相覆盖；
 * 全部格子补齐且状态为 drawing 时推进到 reviewing。返回写入后的图片数量与状态。
 */
export function savePanelImage(
  taskId: string,
  index: number,
  imgPath: string,
  panelCount: number,
): Promise<{ imageCnt: number; status: string }> {
  const run = imageWriteChain.then(async () => {
    const fresh = await db.task.findUnique({ where: { taskId } });
    if (!fresh) throw new Error("任务不存在");
    const base: (string | null)[] = fresh.imagePathsJson
      ? (JSON.parse(fresh.imagePathsJson) as (string | null)[])
      : [];
    while (base.length < panelCount) base.push(null);
    const imagePathsJson = replacePanelImage(JSON.stringify(base), index, imgPath);
    const paths = JSON.parse(imagePathsJson) as (string | null)[];
    const imageCnt = paths.filter(Boolean).length;
    const status =
      imageCnt === panelCount && fresh.status === "drawing" ? "reviewing" : fresh.status;
    await db.task.update({
      where: { taskId },
      data: { imagePathsJson, imageCnt, status },
    });
    return { imageCnt, status };
  });
  // 链尾吞掉异常，避免一格失败阻塞后续格的落库
  imageWriteChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
