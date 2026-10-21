/**
 * 任务在途注册表（进程级）：
 * - 主流程生成（剧本/分格图）以 taskId 为 key 注册，启动时 registerRun，结束时 unregisterRun；
 * - 单格重生成以 panelRunKey(taskId, index) 为 key 注册：多格可并行，同格互斥；
 * - isRunning：精确匹配某一把锁是否被占用（防重复触发 409）；
 * - hasAnyRun：主流程或任一格在途即返回 true，供剧本/批量生图做任务级互斥；
 * - runningPanelIndexes：列出在途单格下标，供任务详情暴露 generatingPanels；
 * - abortRun：停止接口用其中断主流程与全部在途单格。
 */
const running = new Map<string, AbortController>();

export function panelRunKey(taskId: string, index: number): string {
  return `${taskId}::panel:${index}`;
}

function panelKeyPrefix(taskId: string): string {
  return `${taskId}::panel:`;
}

export function registerRun(key: string, controller: AbortController): void {
  running.set(key, controller);
}

export function unregisterRun(key: string): void {
  running.delete(key);
}

/** 精确匹配：某一把锁（主流程 key=taskId 或 panelRunKey）是否被占用 */
export function isRunning(key: string): boolean {
  return running.has(key);
}

/** 任务级：主流程或任一格在途均视为占用 */
export function hasAnyRun(taskId: string): boolean {
  if (running.has(taskId)) return true;
  const prefix = panelKeyPrefix(taskId);
  for (const key of running.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

/** 当前在途的单格下标列表（供任务详情暴露 generatingPanels） */
export function runningPanelIndexes(taskId: string): number[] {
  const prefix = panelKeyPrefix(taskId);
  const indexes: number[] = [];
  for (const key of running.keys()) {
    if (key.startsWith(prefix)) {
      const n = Number(key.slice(prefix.length));
      if (Number.isInteger(n)) indexes.push(n);
    }
  }
  return indexes;
}

/** 中断主流程 run 与全部在途单格 run；返回是否中断了任一 */
export function abortRun(taskId: string): boolean {
  let aborted = false;
  const main = running.get(taskId);
  if (main) {
    main.abort();
    aborted = true;
  }
  const prefix = panelKeyPrefix(taskId);
  for (const [key, controller] of running) {
    if (key.startsWith(prefix)) {
      controller.abort();
      aborted = true;
    }
  }
  return aborted;
}
