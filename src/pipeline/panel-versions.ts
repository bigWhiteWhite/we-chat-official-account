import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * 分格图版本管理：每次生成写入新版本文件 panel-NN.vN.png，磁盘保留全部版本，
 * DB（imagePathsJson）只存当前选中版本的路径。纯函数部分不依赖 fs，可在 Vitest 直接测试。
 */

/** 第 i 格（0 基）的基础名：panel-01 / panel-02 … */
export function panelBaseName(index: number): string {
  return `panel-${String(index + 1).padStart(2, "0")}`;
}

const versionSuffixRe = (base: string) => new RegExp(`^${base}\\.v(0|[1-9]\\d*)\\.png$`);

/**
 * 解析文件名对应的版本：无后缀（旧格式初始版本）→ 0；panel-NN.vN.png → N；
 * 其他格 / 非 png / 非法版本号（如 v01、v）→ null。
 */
export function parsePanelVersion(index: number, fileName: string): number | null {
  const base = panelBaseName(index);
  if (fileName === `${base}.png`) return 0;
  const m = fileName.match(versionSuffixRe(base));
  return m ? Number(m[1]) : null;
}

/**
 * 依据已有文件名算下一版本文件名：vN 表示第 N 次重新生成（从 v1 起）；
 * 旧格式无后缀文件是"初始版本"（版本 0），不占 vN 序号。
 */
export function nextPanelFileName(index: number, existingNames: string[]): string {
  const base = panelBaseName(index);
  const re = versionSuffixRe(base);
  let max = 0;
  for (const name of existingNames) {
    const m = name.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${base}.v${max + 1}.png`;
}

/**
 * 扫描输出目录，算出下一版本文件的完整路径。
 * 并发安全：主流程以 taskId 互斥、单格以 panelRunKey 互斥，同一格不会并发生成。
 */
export async function nextPanelPath(outDir: string, index: number): Promise<string> {
  const names = await readdir(outDir).catch(() => [] as string[]);
  return path.join(outDir, nextPanelFileName(index, names));
}

/** 版本列表排序用条目 */
export type PanelVersionEntry = {
  version: number;
  fileName: string;
  mtimeMs: number;
};

/** 版本列表按版本号升序（初始版本 0 在最前） */
export function sortPanelVersions(entries: PanelVersionEntry[]): PanelVersionEntry[] {
  return [...entries].sort((a, b) => a.version - b.version);
}

/** 路径分隔符归一化为 /（Windows 下 path.join 产生反斜杠，跨形态比较前先归一） */
export function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * 校验请求路径是否为该格的合法版本文件：必须位于任务图片目录内
 * （分隔符归一后前缀匹配）且文件名可解析为该格版本。合法返回文件名，否则 null。
 */
export function resolvePanelVersionFile(
  dir: string,
  index: number,
  requested: string,
): string | null {
  const dirNorm = normalizeSlashes(dir);
  const reqNorm = normalizeSlashes(requested);
  if (!reqNorm.startsWith(dirNorm + "/")) return null;
  const fileName = reqNorm.slice(reqNorm.lastIndexOf("/") + 1);
  if (parsePanelVersion(index, fileName) === null) return null;
  return fileName;
}
