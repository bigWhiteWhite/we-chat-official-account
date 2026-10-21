"use client";

import { useMemo } from "react";

import { TreeSelect, type TreeSelectGroup } from "@/components/tree-select";
import { imageSrc, type AssetSummary } from "@/lib/api";
import { groupAssetsBySeries } from "@/lib/asset-grouping";

/**
 * 资产下拉选择框：TreeSelect 封装（顶部搜索 + 树形/列表切换，按合集分组）。
 * 与合集表单的多选资产选择共用同一交互组件。
 */
export function AssetPicker({
  placeholder = "Select asset…",
  newLabel,
  options,
  value,
  onValueChange,
}: {
  placeholder?: string;
  newLabel?: string;
  options: AssetSummary[];
  value: string | null;
  onValueChange: (id: string | null) => void;
}) {
  const groups = useMemo<TreeSelectGroup[]>(
    () =>
      groupAssetsBySeries(options)
        .filter((g) => g.assets.length > 0)
        .map((g) => ({
          key: g.key,
          label: g.label,
          items: g.assets.map((a) => ({
            id: a.id,
            name: a.name,
            description: a.keywords || undefined,
            image: a.primaryImage ? imageSrc(a.primaryImage) : null,
          })),
        })),
    [options],
  );

  return (
    <TreeSelect
      groups={groups}
      value={value}
      onValueChange={onValueChange}
      newLabel={newLabel}
      placeholder={placeholder}
      searchPlaceholder="搜索名称 / 关键词…"
    />
  );
}
