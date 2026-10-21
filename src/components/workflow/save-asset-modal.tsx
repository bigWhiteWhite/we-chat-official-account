"use client";

import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PreviewImage, preventLightboxInteract } from "@/components/photo-viewer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, imageSrc, type AssetSummary, type AssetType } from "@/lib/api";

export interface SaveTarget {
  type: AssetType;
  name: string;
  image: string;
  key: string;
  /** 回填外观设定（主形象；生成提示词或资产主形象外观），用户可再补充 */
  appearance?: string;
  /** 回填关键词（主体名称或资产关键词），用户可再补充 */
  keywords?: string;
  /** 本集画风资产（角色/场景首变体归属的画风；无画风资产时为空） */
  styleId?: string | null;
  styleName?: string | null;
  /** 当前流程的画风（写入资产 stylePreset 字段，供后续复用） */
  stylePreset?: string | null;
}

/** 存为资产回填：绑定库资产时用资产自身的主形象外观/关键词；否则优先回填任务内外观设定，再退化为生成提示词 + 名称关键词 */
export function buildSavePrefill(opts: {
  kind: "style" | "scene" | "character";
  name: string;
  preset?: string | null;
  asset?: AssetSummary | null;
  /** 任务侧已确认的外观设定（LLM 补全/用户编辑），未绑定资产时优先回填 */
  appearance?: string | null;
}): { appearance: string; keywords: string } {
  if (opts.asset) {
    return {
      appearance: opts.asset.variants[0]?.appearance ?? "",
      keywords: opts.asset.keywords,
    };
  }
  const preset = opts.preset?.trim() || "默认画风";
  if (opts.kind !== "style" && opts.appearance?.trim()) {
    return { appearance: opts.appearance.trim(), keywords: opts.name };
  }
  const appearance =
    opts.kind === "style"
      ? preset
      : opts.kind === "scene"
        ? `场景参考图：${opts.name}，画风：${preset}`
        : `角色三视图：${opts.name}，画风：${preset}`;
  return { appearance, keywords: opts.name };
}

export function SaveAssetModal({
  target,
  sourceTaskId,
  defaultSeriesId,
  onClose,
  onSaved,
}: {
  target: SaveTarget;
  sourceTaskId: string;
  /** 当前任务所属合集 id（如有则作为默认选中） */
  defaultSeriesId?: string | null;
  onClose: () => void;
  onSaved?: (asset: AssetSummary) => void;
}) {
  const queryClient = useQueryClient();
  const { data: seriesData } = useQuery({
    queryKey: ["series", "all"],
    queryFn: () => api.getSeries(),
  });
  const seriesList = seriesData?.series ?? [];

  const form = useForm({
    defaultValues: {
      name: target.name,
      appearance: target.appearance ?? "",
      keywords: target.keywords ?? "",
      seriesId: defaultSeriesId ?? "",
    },
    onSubmit: async ({ value }) => {
      await api.createAsset({
        type: target.type,
        name: value.name.trim(),
        keywords: value.keywords.trim() || undefined,
        seriesLinks: value.seriesId
          ? [
              {
                seriesId: value.seriesId,
                role: target.type === "character" ? "member" : undefined,
              },
            ]
          : undefined,
        imagePaths: target.type === "style" ? [target.image] : undefined,
        stylePreset: target.stylePreset?.trim() || undefined,
        firstVariant:
          target.type === "style"
            ? undefined
            : {
                name: "主形象",
                styleId: target.styleId ?? "",
                styleName: target.styleName ?? "",
                appearance: value.appearance.trim(),
                imagePath: target.image,
              },
        sourceTaskId,
      });
      toast.success("已保存到主体资产库");
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      const saved = await api.getAssets();
      const created = saved.assets.find(
        (a) => a.name === value.name.trim() && a.type === target.type,
      );
      if (created) onSaved?.(created);
      onClose();
    },
  });

  const typeLabel =
    target.type === "character" ? "角色" : target.type === "scene" ? "场景" : "画风";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={preventLightboxInteract}
        onInteractOutside={preventLightboxInteract}
        onEscapeKeyDown={preventLightboxInteract}
      >
        <DialogHeader>
          <DialogTitle>保存为资产</DialogTitle>
          <DialogDescription>{typeLabel}资产将进入主体资产库，可被后续任务复用。</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 py-2">
          <PreviewImage
            src={imageSrc(target.image)}
            alt=""
            className="h-16 w-16 rounded-md border border-slate-200 object-cover"
          />
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {typeLabel}
          </span>
        </div>
        <div className="grid gap-4 py-4">
          <form.Field name="name">
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor="save-asset-name">名称（≤20字）</Label>
                <Input
                  id="save-asset-name"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  maxLength={20}
                />
              </div>
            )}
          </form.Field>
          <form.Field name="appearance">
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor="save-asset-appearance">外观设定（主形象；供复用时参考）</Label>
                <Input
                  id="save-asset-appearance"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  maxLength={500}
                  placeholder="如：白衣长发、手持长剑、清冷气质"
                />
              </div>
            )}
          </form.Field>
          <form.Field name="keywords">
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor="save-asset-keywords">关键词（逗号分隔，供检索匹配）</Label>
                <Input
                  id="save-asset-keywords"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  maxLength={200}
                  placeholder="如：白衣, 长剑, 清冷"
                />
              </div>
            )}
          </form.Field>
          <form.Field name="seriesId">
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor="save-asset-series">所属合集</Label>
                <Select value={field.state.value} onValueChange={(v) => field.handleChange(v)}>
                  <SelectTrigger id="save-asset-series" className="h-9 text-xs">
                    <SelectValue placeholder="不绑定合集" />
                  </SelectTrigger>
                  <SelectContent className="text-xs">
                    <SelectItem value="">不绑定合集</SelectItem>
                    {seriesList.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>{" "}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <form.Subscribe
            selector={(s) => ({
              canSubmit: s.canSubmit && s.values.name.trim().length > 0,
              isSubmitting: s.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button onClick={() => void form.handleSubmit()} disabled={!canSubmit}>
                {isSubmitting ? "保存中…" : "保存"}
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
