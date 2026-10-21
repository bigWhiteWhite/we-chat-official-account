"use client";

import { useEffect, useMemo } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { preventLightboxInteract } from "@/components/photo-viewer";
import { TreeSelect, type TreeSelectGroup } from "@/components/tree-select";
import { TagSelect } from "@/components/tags/tag-select";
import { api, imageSrc, type AssetSummary, type SeriesSummary } from "@/lib/api";
import { groupAssetsBySeries } from "@/lib/asset-grouping";

/** 多选资产选择：TreeSelect 封装（下拉 + 顶部搜索 + 树形/列表切换，按合集分组） */
function MultiAssetList({
  label,
  hint,
  assets,
  selected,
  onToggle,
  disabled,
  emptyText = "暂无可用资产（可先到「主体资产库」创建）",
  primarySeriesId,
}: {
  label: string;
  hint?: string;
  assets: AssetSummary[];
  selected: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
  emptyText?: string;
  primarySeriesId?: string | null;
}) {
  const groups = useMemo<TreeSelectGroup[]>(
    () =>
      groupAssetsBySeries(assets, primarySeriesId ?? null)
        .filter((g) => g.assets.length > 0)
        .map((g) => ({
          key: g.key,
          label: g.label,
          items: g.assets.map((a) => ({
            id: a.id,
            name: a.name,
            description:
              (a.type === "style" ? (a.stylePreset ?? "") : (a.variants[0]?.appearance ?? "")) ||
              undefined,
            image: a.primaryImage ? imageSrc(a.primaryImage) : null,
          })),
        })),
    [assets, primarySeriesId],
  );

  return (
    <TreeSelect
      groups={groups}
      multiple
      selectedIds={selected}
      onToggle={onToggle}
      disabled={disabled}
      emptyText={emptyText}
      triggerLabel={
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0">{label}</span>
          {hint && <span className="truncate text-xs font-normal text-slate-400">· {hint}</span>}
        </span>
      }
      searchPlaceholder="搜索名称 / 关键词…"
    />
  );
}

/**
 * 合集创建 / 编辑对话框。
 * 画风：创建时必选，编辑时锁定不可更换（换画风 = 新建合集）。
 * 主角：可选（角色资产多选）；常设场景：可选。
 */
export function SeriesFormDialog({
  open,
  onOpenChange,
  series,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 传入则为编辑模式，不传为新建 */
  series?: SeriesSummary | null;
  /** 保存成功回调（新建场景可用于自动选中刚创建的合集） */
  onSaved?: (s: SeriesSummary) => void;
}) {
  const queryClient = useQueryClient();
  const editing = !!series;

  const { data: assetsData } = useQuery({
    queryKey: ["assets", "series-form"],
    queryFn: () => api.getAssets(),
    enabled: open,
    retry: false,
  });
  const assets = assetsData?.assets ?? [];
  const { data: tagsData } = useQuery({
    queryKey: ["tags"],
    queryFn: () => api.getTags(),
    enabled: open,
    retry: false,
  });
  const tagOptions = tagsData?.tags ?? [];
  const styles = useMemo(() => assets.filter((a) => a.type === "style"), [assets]);
  const characters = useMemo(() => assets.filter((a) => a.type === "character"), [assets]);
  const scenes = useMemo(() => assets.filter((a) => a.type === "scene"), [assets]);

  const form = useForm({
    defaultValues: {
      name: "",
      intro: "",
      styleIds: [] as string[],
      protos: [] as string[],
      sceneIds: [] as string[],
      memberIds: [] as string[],
      tagIds: [] as string[],
    },
    onSubmit: async ({ value }) => {
      if (!value.name.trim()) {
        toast.error("请填写合集名称");
        return;
      }
      if (value.styleIds.length === 0) {
        toast.error("请至少选择一个画风资产");
        return;
      }
      const body = {
        name: value.name.trim(),
        intro: value.intro.trim(),
        tagIds: value.tagIds,
        styleAssetIds: value.styleIds,
        protagonistIds: value.protos,
        sceneAssetIds: value.sceneIds,
        memberAssetIds: value.memberIds,
      };
      const r = editing ? await api.updateSeries(series!.id, body) : await api.createSeries(body);
      toast.success(editing ? "合集已更新" : "合集已创建");
      void queryClient.invalidateQueries({ queryKey: ["series"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      onSaved?.(r.series);
      onOpenChange(false);
    },
  });
  const values = useStore(form.store, (s) => s.values);

  // 打开时按编辑目标重填表单（新建则清空）
  useEffect(() => {
    if (!open) return;
    const vals = {
      name: series?.name ?? "",
      intro: series?.intro ?? "",
      styleIds: series?.styles?.map((s) => s.id) ?? [],
      protos: series?.protagonists.map((p) => p.id) ?? [],
      sceneIds: series?.sceneAssetIds ?? [],
      memberIds: series?.memberAssetIds ?? [],
      tagIds: series?.tags.map((t) => t.id) ?? [],
    };
    Object.entries(vals).forEach(([k, v]) => form.setFieldValue(k as keyof typeof vals, v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, series]);

  /** 成员候选：未选为主角的角色资产（配角）；画风/场景有各自专属列表，不再混入 */
  const memberAssets = useMemo(() => {
    const taken = new Set([...values.protos, ...values.sceneIds, ...values.styleIds]);
    return assets.filter((a) => a.type === "character" && !taken.has(a.id));
  }, [assets, values.protos, values.sceneIds, values.styleIds]);

  const toggleIds = (key: "styleIds" | "protos" | "sceneIds" | "memberIds") => (id: string) => {
    const list = values[key];
    form.setFieldValue(key, list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const toggleTag = (id: string) =>
    form.setFieldValue(
      "tagIds",
      values.tagIds.includes(id) ? values.tagIds.filter((x) => x !== id) : [...values.tagIds, id],
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[70%]"
        onPointerDownOutside={preventLightboxInteract}
        onInteractOutside={preventLightboxInteract}
        onEscapeKeyDown={preventLightboxInteract}
      >
        <DialogHeader>
          <DialogTitle>{editing ? "编辑合集" : "新建合集"}</DialogTitle>
          <DialogDescription>
            合集 = 固定画风 + 主角（可选）+ 故事设定；剧集是容器里的一个个故事（连载）。
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[calc(85vh-190px)] grid-cols-2 gap-x-4 gap-y-4 overflow-y-auto py-2 pr-1.5">
          <div className="grid gap-2">
            <Label htmlFor="series-name" className="text-sm font-medium text-slate-700">
              合集名称
            </Label>
            <Input
              id="series-name"
              value={values.name}
              onChange={(e) => form.setFieldValue("name", e.target.value)}
              maxLength={50}
              placeholder="如：阿强和他的猫"
            />
          </div>
          <div className="col-span-2">
            <MultiAssetList
              label="画风（必选，可多选）"
              hint="剧集创建时从中选择本集画风，默认第一个"
              assets={styles}
              selected={values.styleIds}
              onToggle={toggleIds("styleIds")}
              emptyText="暂无画风资产，可先到「主体资产库」创建"
              primarySeriesId={series?.id}
            />
          </div>
          <div className="col-span-2 grid gap-2">
            <label htmlFor="series-intro" className="text-sm font-medium text-slate-700">
              故事设定（世界观 / 人物关系 / 长线走向，供剧本 AI 参考）
            </label>
            <Textarea
              id="series-intro"
              rows={3}
              value={values.intro}
              onChange={(e) => form.setFieldValue("intro", e.target.value)}
              placeholder="如：阿强是小区保安，和橘猫「大橘」相依为命，每集围绕一次啼笑皆非的深夜巡逻展开…"
            />
          </div>
          <div className="col-span-2 grid gap-2">
            <p className="text-sm font-medium text-slate-700">
              内容标签
              <span className="text-xs font-normal text-slate-400">
                （可多选，最多 12 个；下拉内可按名称或说明搜索；新建剧集时自动带入）
              </span>
            </p>
            <TagSelect
              tags={tagOptions}
              selected={values.tagIds}
              onToggle={toggleTag}
              className="max-w-xl"
            />
          </div>
          <MultiAssetList
            label="主角（可选，可多选）"
            hint="每集固定出场、外观一致；无固定主角可不选"
            assets={characters}
            selected={values.protos}
            onToggle={toggleIds("protos")}
            primarySeriesId={series?.id}
          />
          <MultiAssetList
            label="常设场景（可选）"
            hint="复用率高的小区 / 楼道 / 车库等"
            assets={scenes}
            selected={values.sceneIds}
            onToggle={toggleIds("sceneIds")}
            emptyText="暂无场景资产，可稍后在主体确认步骤补充"
            primarySeriesId={series?.id}
          />
          <div className="col-span-2">
            <MultiAssetList
              label="其他成员（可选）"
              hint="配角角色，仅归档不锁定出场"
              assets={memberAssets}
              selected={values.memberIds}
              onToggle={toggleIds("memberIds")}
              emptyText="暂无可加入的角色资产"
              primarySeriesId={series?.id}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <form.Subscribe selector={(s) => ({ isSubmitting: s.isSubmitting, name: s.values.name })}>
            {({ isSubmitting, name }) => (
              <Button
                onClick={() => void form.handleSubmit()}
                disabled={isSubmitting || !name.trim()}
              >
                {isSubmitting ? "保存中…" : editing ? "保存修改" : "创建合集"}
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
