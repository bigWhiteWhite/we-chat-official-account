export type PageItem = number | "ellipsis";

/**
 * 计算分页条要展示的页码项：
 * - ≤7 页时全部展示；
 * - 超过 7 页时展示首尾页 + 当前页前后各 1 页，空档用省略号占位。
 */
export function getPageItems(page: number, pageCount: number): PageItem[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const items: PageItem[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) items.push("ellipsis");
  for (let p = start; p <= end; p++) items.push(p);
  if (end < pageCount - 1) items.push("ellipsis");
  items.push(pageCount);
  return items;
}
