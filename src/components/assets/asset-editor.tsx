"use client";

import { useMemo, useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronsUpDown, X } from "lucide-react";

import { preventLightboxInteract } from "@/components/photo-viewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, bustImageCache, type AssetSummary, type AssetType } from "@/lib/api";
import { useUiStore } from "@/store/ui";

import { StyleSample } from "./style-sample";
import { VariantTable } from "./variant-table";
import { useAssetSample } from "./use-asset-sample";
import { useVariantEditor } from "./use-variant-editor";
import { VARIANT_LABELS } from "./variant-labels";

const TYPE_OPTIONS: Array<{ value: AssetType; label: string }> = [
  { value: "character", label: "角色" },
  { value: "scene", label: "场景" },
  { value: "style", label: "画风" },
];

/** 资产归入合集时的默认角色，随资产类型推断（角色默认成员，升为主角需手动切换） */
function defaultRoleFor(t: AssetType): string {
  if (t === "style") return "style";
  if (t === "scene") return "scene";
  return "member";
}

/**
 * 资产新建/编辑弹窗（v3）：
 * - 角色/场景：形象 = 变体列表（画风 + 外观设定 + 参考图），可增/改（重新生成）/删/设主；
 *   新建时先填主形象表单，保存后成为列表首项
 * - 画风：风格文本 + 样图（AI 生成/上传）
 */
export function AssetEditor({
  mode,
  asset,
  onClose,
}: {
  mode: "create" | "edit";
  asset?: AssetSummary;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: {
      type: (asset?.type ?? "character") as AssetType,
      name: asset?.name ?? "",
      keywords: asset?.keywords ?? "",
      stylePreset: asset?.stylePreset ?? "",
      characterProfile: asset?.characterProfile ?? "",
      personality: asset?.personality ?? "",
      traits: asset?.traits ?? "",
    },
    onSubmit: async ({ value }) => {
      if (!value.name.trim()) return;
      // 保存前校验：画风必选、外观设定不可为空、参考图必须有
      const isCS = value.type !== "style";
      if (isCS) {
        const allVariants: Array<{
          name: string;
          styleId: string;
          appearance: string;
          image: string | null;
        }> = [];
        if (mode === "create" && editor.variants.length === 0) {
          allVariants.push({
            name: editor.draft.name.trim() || "主形象",
            styleId: editor.draft.styleId,
            appearance: editor.draft.appearance,
            image: editor.draft.imageBase64,
          });
        }
        for (const v of editor.variants) {
          allVariants.push(v);
        }
        if (
          editor.showAdd &&
          (editor.draft.imageBase64 || editor.draft.name.trim() || editor.draft.appearance.trim())
        ) {
          allVariants.push({
            name: editor.draft.name.trim() || "未命名",
            styleId: editor.draft.styleId,
            appearance: editor.draft.appearance,
            image: editor.draft.imageBase64,
          });
        }
        for (const v of allVariants) {
          if (!v.styleId) {
            toast.error("请为「" + (v.name || "未命名") + "」选择画风");
            return;
          }
          if (!v.appearance.trim()) {
            toast.error(
              "请为「" +
                (v.name || "未命名") +
                "」填写" +
                (value.type === "scene" ? "场景设定" : "外观设定"),
            );
            return;
          }
          if (!v.image) {
            toast.error("请为「" + (v.name || "未命名") + "」生成或上传参考图");
            return;
          }
        }
      }
      try {
        const seriesLinksPayload = Object.entries(seriesSel).map(([seriesId, role]) => ({
          seriesId,
          role: role as "protagonist" | "scene" | "style" | "member",
        }));
        if (mode === "create" || !asset) {
          await api.createAsset({
            type: value.type,
            name: value.name.trim(),
            keywords: value.keywords.trim(),
            stylePreset: value.type === "style" ? value.stylePreset.trim() : undefined,
            characterProfile: value.characterProfile.trim(),
            personality: value.personality.trim(),
            traits: value.traits.trim(),
            ...(value.type === "style" && sample.base64
              ? { imageBase64: sample.base64, mimeType: sample.mime as "image/png" | "image/jpeg" }
              : {}),
            ...(isCharacterScene && editor.draft.imageBase64
              ? {
                  firstVariant: {
                    name: editor.draft.name.trim() || "主形象",
                    styleId: editor.draft.styleId || undefined,
                    appearance: editor.draft.appearance.trim(),
                    imageBase64: editor.draft.imageBase64,
                    mimeType: editor.draft.mime as "image/png" | "image/jpeg",
                  },
                }
              : {}),
            ...(seriesLinksPayload.length > 0 ? { seriesLinks: seriesLinksPayload } : {}),
          });
          toast.success("资产已创建");
        } else {
          // 编辑模式：先提交所有本地变体改动，再更新资产元数据
          await editor.commitLocalChanges(asset.id);
          await api.updateAsset(asset.id, {
            name: value.name.trim(),
            keywords: value.keywords.trim(),
            stylePreset: value.type === "style" ? value.stylePreset.trim() : undefined,
            characterProfile: value.characterProfile.trim(),
            personality: value.personality.trim(),
            traits: value.traits.trim(),
            ...(value.type === "style" && sample.base64
              ? { imageBase64: sample.base64, mimeType: sample.mime as "image/png" | "image/jpeg" }
              : {}),
            ...(value.type === "style" && sample.removed ? { removeImage: true } : {}),
            seriesLinks: seriesLinksPayload,
          });
          toast.success("资产已更新");
        }
        // 画风样图/变体图可能按原路径覆盖写入，递增版本号避免浏览器展示旧图
        bustImageCache();
        void queryClient.invalidateQueries({ queryKey: ["assets"] });
        void queryClient.invalidateQueries({ queryKey: ["series"] });
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "保存失败");
      }
    },
  });
  const values = useStore(form.store, (s) => s.values);

  // 画风样图（仅 style 类型）
  const genSize = useUiStore((s) => s.genSize);
  const setGenSize = useUiStore((s) => s.setGenSize);
  const sample = useAssetSample({
    type: values.type,
    name: values.name,
    stylePreset: values.stylePreset,
    size: genSize,
  });

  const [seriesSel, setSeriesSel] = useState<Record<string, string>>(() =>
    Object.fromEntries((asset?.seriesLinks ?? []).map((l) => [l.seriesId, l.role])),
  );
  const [seriesPickerOpen, setSeriesPickerOpen] = useState(false);
  const selectedEntries = Object.entries(seriesSel);
  const { data: seriesData } = useQuery({
    queryKey: ["series", "asset-editor"],
    queryFn: () => api.getSeries(),
    retry: false,
  });
  const seriesList = seriesData?.series ?? [];

  /** 变体画风候选：优先资产所属合集内的画风，否则全库画风资产 */
  const { data: styleAssetsData } = useQuery({
    queryKey: ["assets", "variant-style-options"],
    queryFn: () => api.getAssets({ type: "style" }),
    retry: false,
    enabled: values.type !== "style",
  });
  const variantStyleOptions = useMemo(() => {
    const styleAssets = styleAssetsData?.assets ?? [];
    const linkedSeriesIds = new Set((asset?.seriesLinks ?? []).map((l) => l.seriesId));
    const fromSeries = new Set<string>();
    for (const s of seriesList) {
      if (!linkedSeriesIds.has(s.id)) continue;
      for (const st of s.styles) fromSeries.add(st.id);
    }
    const inSeries = styleAssets.filter((a) => fromSeries.has(a.id));
    return inSeries.length > 0 ? inSeries : styleAssets;
  }, [styleAssetsData, seriesList, asset]);

  // 形象变体（角色/场景）：状态与操作集中在 useVariantEditor
  const kind = values.type === "scene" ? "scene" : "character";
  const editor = useVariantEditor({ mode, asset, kind, name: values.name, variantStyleOptions });

  const isCharacterScene = values.type !== "style";

  function handleTypeChange(next: AssetType) {
    form.setFieldValue("type", next);
    if (mode === "create") sample.resetSample();
  }

  /** 删除确认弹窗打开时，外层弹窗忽略点击外部 / ESC，避免误关主弹窗 */
  function guardOuterClose(event: { preventDefault(): void }) {
    if (editor.deleteTarget !== null || editor.appearanceCtx !== null) event.preventDefault();
    else preventLightboxInteract(event);
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          className="w-[70%] sm:max-w-none"
          onPointerDownOutside={guardOuterClose}
          onInteractOutside={guardOuterClose}
          onEscapeKeyDown={guardOuterClose}
        >
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "新建资产" : `编辑「${asset?.name}」`}</DialogTitle>
            <DialogDescription>
              {values.type === "style"
                ? "画风资产：风格文本 + 样图"
                : `${kind === "scene" ? "场景" : "形象"} = 画风 + ${VARIANT_LABELS[kind].setting} + 参考图；列表第一项为${VARIANT_LABELS[kind].primary}，主体确认时按本集画风自动选用`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <p className="text-sm font-medium text-slate-600">类型</p>
              <Select
                value={values.type}
                onValueChange={(v) => handleTypeChange(v as AssetType)}
                disabled={mode === "edit"}
              >
                <SelectTrigger className="mt-1 h-8 w-fit min-w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-600">
                所属合集
                <span className="ml-2 text-xs font-normal text-slate-400">
                  可归入多个合集（不选=未归类）
                </span>
              </p>
              {seriesList.length === 0 ? (
                <p className="mt-1 text-xs text-slate-400">暂无合集，可先到「合集」创建。</p>
              ) : (
                <div className="mt-1 space-y-1.5">
                  <Popover open={seriesPickerOpen} onOpenChange={setSeriesPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={seriesPickerOpen}
                        className="w-full cursor-pointer justify-between gap-2 font-normal"
                      >
                        <span
                          className={`truncate text-sm ${
                            selectedEntries.length === 0 ? "text-slate-400" : "text-slate-700"
                          }`}
                        >
                          选择合集…
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {selectedEntries.length > 0 && (
                            <Badge variant="secondary" className="rounded-full px-2 text-[10px]">
                              已选 {selectedEntries.length}
                            </Badge>
                          )}
                          <ChevronsUpDown className="h-4 w-4 text-slate-400" />
                        </span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popper-anchor-width)] min-w-56 p-0"
                    >
                      <Command>
                        <CommandInput placeholder="搜索合集…" />
                        <CommandList>
                          <CommandEmpty>无匹配合集</CommandEmpty>
                          <CommandGroup>
                            {seriesList.map((s) => {
                              const on = s.id in seriesSel;
                              return (
                                <CommandItem
                                  key={s.id}
                                  value={s.name}
                                  data-checked={on}
                                  className="cursor-pointer"
                                  onSelect={() =>
                                    setSeriesSel((prev) => {
                                      const next = { ...prev };
                                      if (on) delete next[s.id];
                                      else next[s.id] = defaultRoleFor(values.type);
                                      return next;
                                    })
                                  }
                                >
                                  <span className="truncate">{s.name}</span>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {selectedEntries.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedEntries.map(([id, role]) => {
                        const s = seriesList.find((x) => x.id === id);
                        if (!s) return null;
                        return (
                          <span
                            key={id}
                            className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-white py-0.5 pl-2 text-xs"
                          >
                            <span className="max-w-40 truncate text-slate-700">{s.name}</span>
                            {values.type === "style" ? (
                              <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-700">
                                画风
                              </span>
                            ) : (
                              <Select
                                value={role}
                                onValueChange={(v) =>
                                  setSeriesSel((prev) => ({ ...prev, [id]: v }))
                                }
                              >
                                <SelectTrigger className="h-6 w-fit cursor-pointer gap-0.5 border-0 bg-transparent px-1.5 text-xs shadow-none">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {values.type === "character" ? (
                                    <>
                                      <SelectItem value="protagonist">主角</SelectItem>
                                      <SelectItem value="member">成员</SelectItem>
                                    </>
                                  ) : (
                                    <>
                                      <SelectItem value="scene">常设场景</SelectItem>
                                      <SelectItem value="member">成员</SelectItem>
                                    </>
                                  )}
                                </SelectContent>
                              </Select>
                            )}
                            <button
                              type="button"
                              aria-label={`移除合集 ${s.name}`}
                              onClick={() =>
                                setSeriesSel((prev) => {
                                  const next = { ...prev };
                                  delete next[id];
                                  return next;
                                })
                              }
                              className="mr-1 cursor-pointer rounded-sm p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div>
              <form.Field name="name">
                {(field) => (
                  <Label className="text-sm font-medium text-slate-600">
                    名称
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value.slice(0, 50))}
                      onBlur={field.handleBlur}
                      className="mt-1 py-1.5"
                      placeholder="如：杨过"
                    />
                  </Label>
                )}
              </form.Field>
            </div>
            <div>
              <form.Field name="keywords">
                {(field) => (
                  <Label className="text-sm font-medium text-slate-600">
                    关键词（逗号分隔）
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value.slice(0, 200))}
                      onBlur={field.handleBlur}
                      className="mt-1 py-1.5"
                      placeholder="杨过, 剑, 白衣"
                    />
                  </Label>
                )}
              </form.Field>
            </div>
            {values.type === "character" && (
              <div className="col-span-2 space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
                <p className="text-xs font-semibold text-slate-500">角色设定（供剧本创作使用）</p>
                <form.Field name="characterProfile">
                  {(field) => (
                    <div>
                      <Label className="text-sm font-medium text-slate-600">
                        人物设定
                        <Textarea
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value.slice(0, 500))}
                          onBlur={field.handleBlur}
                          rows={3}
                          className="mt-1 py-1.5"
                          placeholder="身份/背景/与主角的关系等稳定设定"
                        />
                      </Label>
                    </div>
                  )}
                </form.Field>
                <div className="grid grid-cols-2 gap-3">
                  <form.Field name="personality">
                    {(field) => (
                      <div>
                        <Label className="text-sm font-medium text-slate-600">
                          性格
                          <Textarea
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value.slice(0, 500))}
                            onBlur={field.handleBlur}
                            rows={2}
                            className="mt-1 py-1.5"
                            placeholder="如：外冷内热、嘴硬心软、爱逞强"
                          />
                        </Label>
                      </div>
                    )}
                  </form.Field>
                  <form.Field name="traits">
                    {(field) => (
                      <div>
                        <Label className="text-sm font-medium text-slate-600">
                          专属小特点
                          <Textarea
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value.slice(0, 500))}
                            onBlur={field.handleBlur}
                            rows={2}
                            className="mt-1 py-1.5"
                            placeholder="口头禅/小动作/标志性习惯"
                          />
                        </Label>
                      </div>
                    )}
                  </form.Field>
                </div>
              </div>
            )}
            {values.type === "style" && (
              <div className="col-span-2">
                <form.Field name="stylePreset">
                  {(field) => (
                    <Label className="text-sm font-medium text-slate-600">
                      风格文本
                      <Textarea
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value.slice(0, 300))}
                        onBlur={field.handleBlur}
                        rows={2}
                        className="mt-1 py-1.5"
                        placeholder="简约线条 + 低饱和色块 + 扁平卡通"
                      />
                    </Label>
                  )}
                </form.Field>
              </div>
            )}

            {values.type === "style" && (
              <StyleSample
                sample={sample}
                assetImage={asset?.imagePaths[0] ?? null}
                genSize={genSize}
                setGenSize={setGenSize}
              />
            )}

            {isCharacterScene && (
              <VariantTable
                kind={kind}
                mode={mode}
                name={values.name}
                variantStyleOptions={variantStyleOptions}
                editor={editor}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <form.Subscribe
              selector={(s) => ({
                isSubmitting: s.isSubmitting,
                can: s.values.name.trim().length > 0,
              })}
            >
              {({ isSubmitting, can }) => (
                <Button onClick={() => void form.handleSubmit()} disabled={!can || isSubmitting}>
                  {isSubmitting ? "保存中…" : "保存"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
