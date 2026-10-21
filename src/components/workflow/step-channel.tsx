"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Check, Palette, Sparkles, SquarePen, Tags, Users } from "lucide-react";

import { SeriesFormDialog } from "@/components/series/series-form-dialog";
import { TagSelect } from "@/components/tags/tag-select";
import { TreeSelect, type TreeSelectGroup } from "@/components/tree-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { api, imageSrc } from "@/lib/api";

export function StepChannel({
  outline,
  tagIds,
  seriesId,
  seriesStyleId,
  carryContext,
  castIds,
  onCastChange,
  onOutline,
  onTagIds,
  onSeriesChange,
  onSeriesStyleChange,
  onCarryContextChange,
  disabled,
}: {
  outline: string;
  tagIds: string[];
  seriesId: string | null;
  seriesStyleId: string | null;
  carryContext: boolean;
  castIds: string[];
  onOutline: (value: string) => void;
  onTagIds: (ids: string[]) => void;
  onSeriesChange: (id: string | null) => void;
  onSeriesStyleChange: (id: string | null) => void;
  onCarryContextChange: (value: boolean) => void;
  onCastChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const { data: seriesData } = useQuery({
    queryKey: ["series"],
    queryFn: () => api.getSeries(),
    enabled: !disabled,
  });
  const { data: tagsData } = useQuery({
    queryKey: ["tags"],
    queryFn: () => api.getTags(),
    enabled: !disabled,
    retry: false,
  });
  const seriesList = seriesData?.series ?? [];
  const tagOptions = tagsData?.tags ?? [];
  const selectedSeries = seriesList.find((s) => s.id === seriesId) ?? null;

  const prefilledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!seriesId) {
      prefilledFor.current = null;
      onSeriesStyleChange(null);
      return;
    }
    if (!selectedSeries || prefilledFor.current === seriesId) return;
    prefilledFor.current = seriesId;
    if (selectedSeries.tags.length > 0) onTagIds(selectedSeries.tags.map((t) => t.id));
    onCastChange(selectedSeries.protagonists.map((p) => p.id));
    onSeriesStyleChange(selectedSeries.styles[0]?.id ?? null);
  }, [seriesId, selectedSeries, onTagIds, onCastChange, onSeriesStyleChange]);

  /** 本集画风候选（合集绑定的画风资产） */
  const styleGroups = useMemo<TreeSelectGroup[]>(() => {
    if (!selectedSeries) return [];
    return [
      {
        key: "style",
        label: "合集画风",
        items: selectedSeries.styles.map((st) => ({
          id: st.id,
          name: st.name,
          description: st.stylePreset ?? undefined,
          image: st.image ? imageSrc(st.image) : null,
        })),
      },
    ].filter((g) => g.items.length > 0);
  }, [selectedSeries]);

  /** 本集出场角色候选：主角与配角分两组 */
  const castGroups = useMemo<TreeSelectGroup[]>(() => {
    if (!selectedSeries) return [];
    return [
      {
        key: "protagonist",
        label: "主角",
        items: selectedSeries.protagonists.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.keywords || undefined,
          image: p.image ? imageSrc(p.image) : null,
        })),
      },
      {
        key: "member",
        label: "配角",
        items: selectedSeries.members
          .filter((m) => m.type === "character")
          .map((m) => ({
            id: m.id,
            name: m.name,
            image: m.image ? imageSrc(m.image) : null,
          })),
      },
    ].filter((g) => g.items.length > 0);
  }, [selectedSeries]);

  const toggleCast = (id: string) =>
    onCastChange(castIds.includes(id) ? castIds.filter((x) => x !== id) : [...castIds, id]);

  const toggleTag = (id: string) =>
    onTagIds(tagIds.includes(id) ? tagIds.filter((x) => x !== id) : [...tagIds, id]);

  const mode = outline.trim() ? "用户供稿" : "LLM 自创";

  return (
    <div className="space-y-6">
      {/* 创作通道 */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Sparkles className="size-4 text-primary" />
          创作通道
        </h3>
        <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-3" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              AI 创作
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                当前模式：{mode}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">选题材 / 填大纲让 AI 展开成剧本</p>
          </div>
        </div>
      </div>

      <Separator />

      {/* 合集 · 连载设定 */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <BookOpen className="size-4 text-primary" />
            合集 · 连载设定
          </h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => setFormOpen(true)}
            className="h-7 px-2 text-xs"
          >
            + 新建合集
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={seriesId ?? "none"}
            onValueChange={(v) => onSeriesChange(v === "none" ? null : v)}
            disabled={disabled}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="选择所属合集…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">不加入合集</SelectItem>
              {seriesList.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}（{s.episodeCount} 集）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">选择合集后自动带入画风、主角与已有设定</p>
        </div>

        {selectedSeries && (
          <div className="mt-3 space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            {/* 画风 */}
            {selectedSeries.styles.length > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-foreground">
                  <Palette className="size-3.5 text-muted-foreground" />
                  本集画风
                  <span className="font-normal text-muted-foreground">
                    · 默认选中第一个，可切换
                  </span>
                </p>
                <TreeSelect
                  groups={styleGroups}
                  value={seriesStyleId}
                  onValueChange={onSeriesStyleChange}
                  disabled={disabled}
                  placeholder="使用合集默认画风"
                  searchPlaceholder="搜索画风 / 关键词…"
                  triggerClassName="w-72"
                  emptyText="合集未绑定画风资产"
                />
              </div>
            )}

            {/* 上下文携带 */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                id="carry-context"
                checked={carryContext}
                disabled={disabled}
                onCheckedChange={(c) => onCarryContextChange(c === true)}
                className="size-4"
              />
              <label
                htmlFor="carry-context"
                className={`${disabled ? "" : "cursor-pointer"} select-none`}
                onClick={() => {
                  if (!disabled) onCarryContextChange(!carryContext);
                }}
              >
                剧本生成时带入最近 3 集剧情简介（保持连载连续性）
              </label>
            </div>

            {/* 出场角色 */}
            <div>
              <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-foreground">
                <Users className="size-3.5 text-muted-foreground" />
                本集出场角色
                <span className="font-normal text-muted-foreground">
                  · 默认主角全部出场，可增减
                </span>
              </p>
              <TreeSelect
                groups={castGroups}
                multiple
                selectedIds={castIds}
                onToggle={toggleCast}
                disabled={disabled}
                triggerLabel="本集出场角色"
                placeholder="选择本集出场角色…"
                searchPlaceholder="搜索角色名 / 关键词…"
                triggerClassName="w-72"
                emptyText="合集未绑定角色资产"
              />
            </div>
          </div>
        )}
      </div>

      {/* 内容标签 */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Tags className="size-4 text-primary" />
          内容标签
          <span className="font-normal text-muted-foreground">
            （可多选，下拉内按名称或说明搜索；留空由 AI 自由发挥）
          </span>
        </h3>
        <TagSelect
          tags={tagOptions}
          selected={tagIds}
          onToggle={toggleTag}
          disabled={disabled}
          className="max-w-xl"
        />
      </div>

      {/* 选题 / 大纲 */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
          <SquarePen className="size-4 text-primary" />
          选题 / 大纲
          <span className="font-normal text-muted-foreground">（可选，留空则由 LLM 自创选题）</span>
        </h3>
        <Textarea
          id="wizard-outline"
          rows={4}
          value={outline}
          onChange={(e) => onOutline(e.target.value)}
          placeholder="输入漫画主题、剧情梗概或参考素材…"
          disabled={disabled}
        />
      </div>

      {/* 底部状态 */}
      <p className="text-xs text-muted-foreground">
        当前模式：{mode} · 创建任务后进入剧本创作（AI 流式生成，可对话修改）
      </p>

      <SeriesFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={(s) => onSeriesChange(s.id)}
      />
    </div>
  );
}
