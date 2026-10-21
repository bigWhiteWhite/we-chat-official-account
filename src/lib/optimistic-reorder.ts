import { arrayMove } from "@dnd-kit/sortable";
import type { QueryClient } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { toast } from "sonner";

/**
 * dnd-kit 乐观重排共享工具（"松手即落位、不闪回"）。
 *
 * 在 onDragEnd 时：先用 flushSync 把新顺序同步写回 React Query 缓存，让列表重排
 * 与 dnd-kit 的 transform 复位在同一帧提交，避免"先弹回原位再移动"的闪回；随后
 * 持久化，失败则还原为拖拽前状态并提示。
 */
export interface ReorderSpec<T, D> {
  queryKey: readonly unknown[];
  /** 从查询数据中取出可排序列表 */
  getItems: (data: D) => readonly T[];
  /** 用新顺序重建查询数据（正向乐观更新用；回滚直接还原拖拽前的 data） */
  apply: (data: D, next: T[], fromIdx: number, toIdx: number) => D;
  /** 取元素稳定 id（允许按位置，如分格按下标） */
  idOf: (item: T, index: number) => string;
  /** 持久化新顺序；成功正常返回，失败应抛错 */
  persist: (args: { order: string[]; fromIdx: number; toIdx: number }) => Promise<unknown>;
  successMsg?: string;
  errorMsg?: string;
  /** 已落位、真正开始持久化前回调 */
  onStart?: () => void;
  /** 持久化结束回调（ok=false 表示已回滚） */
  onFinish?: (ok: boolean) => void;
}

/** 生成绑定到某个查询的重排函数：reorder(fromId, toId) => 是否真正移动了 */
export function makeReorder<T, D>(
  queryClient: QueryClient,
  spec: ReorderSpec<T, D>,
): (fromId: string, toId: string) => Promise<boolean> {
  return async function reorder(fromId: string, toId: string) {
    const data = queryClient.getQueryData<D>(spec.queryKey);
    if (!data) return false;
    const list = spec.getItems(data);
    const fromIdx = list.findIndex((it, i) => spec.idOf(it, i) === fromId);
    const toIdx = list.findIndex((it, i) => spec.idOf(it, i) === toId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return false;

    const prev = data;
    const moved = arrayMove([...(list as T[])], fromIdx, toIdx);

    // 松手即落位：同步（flushSync）写缓存，保证与 dnd-kit 复位同帧提交，消除闪回
    flushSync(() => {
      queryClient.setQueryData<D>(spec.queryKey, (old) =>
        old ? spec.apply(old, moved, fromIdx, toIdx) : old,
      );
    });

    spec.onStart?.();
    try {
      await spec.persist({ order: moved.map((it, i) => spec.idOf(it, i)), fromIdx, toIdx });
      if (spec.successMsg) toast.success(spec.successMsg);
      spec.onFinish?.(true);
    } catch (err) {
      flushSync(() => {
        queryClient.setQueryData<D>(spec.queryKey, prev);
      });
      toast.error(err instanceof Error ? err.message : (spec.errorMsg ?? "排序失败"));
      spec.onFinish?.(false);
    }
    return true;
  };
}
