import type { AssetSummary } from "./api";

export type AssetGroup = {
  /** "series:<id>" | "unassigned" */
  key: string;
  label: string;
  seriesId: string | null;
  assets: AssetSummary[];
};

/**
 * 按所属合集对资产做目录树分组（纯函数，便于单测）。
 *
 * - 资产可跨多合集：树中按其「第一个」关联的合集归组（主归属），其余合集不重复出现。
 * - 无关联的资产归入「未归类」。
 * - 排序：primarySeriesId 对应分组置顶 → 其余按合集名中文排序 → 未归类最后。
 */
export function groupAssetsBySeries(
  assets: AssetSummary[],
  primarySeriesId?: string | null,
): AssetGroup[] {
  const byName = (x: AssetSummary, y: AssetSummary) => x.name.localeCompare(y.name, "zh-Hans-CN");
  const seriesMap = new Map<string, AssetGroup>();
  const unassigned: AssetSummary[] = [];

  for (const asset of assets) {
    const first = asset.seriesLinks?.[0];
    if (!first) {
      unassigned.push(asset);
      continue;
    }
    const key = `series:${first.seriesId}`;
    let group = seriesMap.get(key);
    if (!group) {
      group = {
        key,
        label: first.seriesName || "合集",
        seriesId: first.seriesId,
        assets: [],
      };
      seriesMap.set(key, group);
    }
    group.assets.push(asset);
  }

  for (const group of seriesMap.values()) group.assets.sort(byName);
  unassigned.sort(byName);

  const seriesGroups = [...seriesMap.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "zh-Hans-CN"),
  );

  const result: AssetGroup[] = [];
  if (primarySeriesId) {
    const primary = seriesGroups.find((g) => g.seriesId === primarySeriesId);
    if (primary) {
      result.push(primary);
      const rest = seriesGroups.filter((g) => g.seriesId !== primarySeriesId);
      result.push(...rest);
    }
  }
  if (result.length === 0) result.push(...seriesGroups);
  result.push({ key: "unassigned", label: "未归类", seriesId: null, assets: unassigned });
  return result;
}
