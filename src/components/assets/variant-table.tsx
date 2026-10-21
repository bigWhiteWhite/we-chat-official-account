"use client";

import { SparklesIcon, StarIcon, UploadIcon, XIcon } from "lucide-react";
import { LayoutIcon } from "lucide-react";

import { PreviewImage, preventLightboxInteract } from "@/components/photo-viewer";
import { ImageGenMask } from "@/components/workflow/image-gen-mask";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { imageSrc } from "@/lib/api";

import { AppearanceDialog } from "./appearance-dialog";
import { VARIANT_LABELS, type VariantKind } from "./variant-labels";
import type { StyleOption, Variant, VariantEditor } from "./use-variant-editor";

export function VariantTable({
  kind,
  mode,
  name,
  variantStyleOptions,
  editor,
}: {
  kind: VariantKind;
  mode: "create" | "edit";
  name: string;
  variantStyleOptions: StyleOption[];
  editor: VariantEditor;
}) {
  const labels = VARIANT_LABELS[kind];
  const {
    variants,
    draft,
    setDraft,
    draftBusy,
    regenBusyIds,
    showAdd,
    setShowAdd,
    deleteTarget,
    setDeleteTarget,
    deleteTargetVariant,
    appearanceCtx,
    setAppearanceCtx,
    draftFileRef,
    addDraftFileRef,
    startAdd,
    resetDraft,
    handleAppearanceSave,
    handleGenerateVariant,
    handleDraftFile,
    handleFieldChange,
    handleVariantRegen,
    handleVariantFile,
    handleGenerateAndAdd,
    handleDraftFileAndAdd,
    handleDeleteVariant,
    handleSetPrimary,
    genSize,
    setGenSize,
  } = editor;

  const primaryId = variants.length > 0 ? variants[0].id : null;

  const appearanceDialog = appearanceCtx
    ? {
        title:
          appearanceCtx.kind === "display"
            ? `${labels.setting} · ${variants.find((v) => v.id === appearanceCtx.variantId)?.name || labels.unit}`
            : labels.setting,
        initial:
          appearanceCtx.kind === "display"
            ? (variants.find((v) => v.id === appearanceCtx.variantId)?.appearance ?? "")
            : draft.appearance,
      }
    : null;

  /** 行内表单行（新建主形象 / 新增 / 编辑现有变体共用） */
  function renderFormRow(v: Variant | null, isAdd: boolean) {
    const rowKey = v ? v.id : isAdd ? "add-row" : "primary-row";
    const isPrimary = v ? v.id === primaryId : false;
    const isRegen = v ? regenBusyIds.has(v.id) : false;

    const previewSrc = draft.imageBase64
      ? `data:${draft.mime};base64,${draft.imageBase64}`
      : v?.image
        ? imageSrc(v.image)
        : null;

    return (
      <TableRow
        key={rowKey}
        className={
          v || isAdd
            ? "border-slate-100 bg-sky-50/50 align-middle"
            : "border-slate-100 bg-sky-50/50 align-middle"
        }
      >
        <TableCell className="align-middle px-2 py-2">
          {(v ? isRegen : draftBusy) ? (
            <div className="relative h-10 w-10 overflow-hidden rounded-sm border border-slate-200">
              <ImageGenMask label="生成中" />
            </div>
          ) : previewSrc ? (
            <PreviewImage
              src={previewSrc}
              alt={draft.name || v?.name || labels.unit}
              className="h-10 w-10 rounded-sm border border-slate-200 object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-dashed border-slate-300 text-[10px] text-slate-400">
              待生成
            </div>
          )}
        </TableCell>
        <TableCell className="align-middle px-2 py-1.5">
          {v ? (
            <Input
              value={v.name}
              onChange={(e) => handleFieldChange(v.id, "name", e.target.value.slice(0, 20))}
              placeholder={labels.name}
              className="h-7 w-20 py-0 text-xs"
            />
          ) : (
            <Input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value.slice(0, 20) }))}
              placeholder={`${labels.name}（可选）`}
              className="h-7 w-20 py-0 text-xs"
            />
          )}
        </TableCell>
        <TableCell className="align-middle px-2 py-1.5">
          {v ? (
            <Select
              value={v.styleId || undefined}
              onValueChange={(val) => handleFieldChange(v.id, "styleId", val)}
            >
              <SelectTrigger className="h-7 w-full min-w-28 text-xs">
                <SelectValue placeholder="选择画风" />
              </SelectTrigger>
              <SelectContent>
                {variantStyleOptions.map((st) => (
                  <SelectItem key={st.id} value={st.id}>
                    {st.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select
              value={draft.styleId || undefined}
              onValueChange={(val) => setDraft((d) => ({ ...d, styleId: val }))}
              disabled={draftBusy}
            >
              <SelectTrigger className="h-7 w-full min-w-28 text-xs">
                <SelectValue placeholder="选择画风" />
              </SelectTrigger>
              <SelectContent>
                {variantStyleOptions.map((st) => (
                  <SelectItem key={st.id} value={st.id}>
                    {st.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </TableCell>
        <TableCell className="align-middle px-2 py-1.5">
          {v ? (
            <Button
              variant="outline"
              onClick={() => setAppearanceCtx({ kind: "display", variantId: v.id })}
              disabled={draftBusy}
              title={v.appearance.trim() || undefined}
              className="h-7 w-full min-w-40 max-w-64 justify-start gap-1 px-2 text-left text-xs"
            >
              <span className="text-[10px]">✎</span>
              <span className="min-w-0 truncate">
                {v.appearance.trim() || `点击填写${labels.setting}`}
              </span>
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => setAppearanceCtx({ kind: "form" })}
              disabled={draftBusy}
              title={draft.appearance.trim() || undefined}
              className="h-7 w-full min-w-40 max-w-64 justify-start gap-1 px-2 text-left text-xs"
            >
              <span className="text-[10px]">✎</span>
              <span className="min-w-0 truncate">
                {draft.appearance.trim() || `点击填写${labels.setting}`}
              </span>
            </Button>
          )}
        </TableCell>
        <TableCell className="align-middle whitespace-nowrap px-2 py-1.5 text-right">
          <div className="flex items-center justify-end gap-1">
            {v ? (
              <>
                {primaryId !== v.id && (
                  <Button
                    variant="ghost"
                    onClick={() => handleSetPrimary(v.id)}
                    disabled={!v.styleId || !v.appearance.trim() || !v.image}
                    className="h-7 px-2 text-xs text-amber-600 hover:bg-amber-50"
                  >
                    <StarIcon className="mr-1 h-3 w-3" />
                    {isPrimary ? "主" : `设为${labels.primary}`}
                  </Button>
                )}
                {primaryId === v.id && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                    主
                  </span>
                )}
                <Button
                  variant="outline"
                  onClick={() => void handleVariantRegen(v.id)}
                  disabled={isRegen || !name.trim()}
                  className="h-7 px-2 text-xs"
                >
                  <SparklesIcon className="mr-1 h-3 w-3" />
                  {isRegen ? "生成中…" : "重新生成"}
                </Button>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  id={`vfu-${v.id}`}
                  className="hidden"
                  onChange={(e) => void handleVariantFile(v.id, e)}
                />
                <Button
                  variant="outline"
                  onClick={() => document.getElementById(`vfu-${v.id}`)?.click()}
                  disabled={isRegen}
                  className="h-7 px-2 text-xs"
                >
                  <UploadIcon className="mr-1 h-3 w-3" />
                  上传
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setDeleteTarget(v.id)}
                  className="h-7 px-2 text-xs text-red-500 hover:bg-red-50"
                >
                  <XIcon className="mr-1 h-3 w-3" />
                  删除
                </Button>
              </>
            ) : !isAdd ? (
              <>
                <Button
                  onClick={() => void handleGenerateVariant()}
                  disabled={draftBusy || !name.trim()}
                  className="h-7 px-2 text-xs"
                >
                  <SparklesIcon className="mr-1 h-3 w-3" />
                  {draftBusy ? "生成中…" : "AI 生成"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => draftFileRef.current?.click()}
                  disabled={draftBusy}
                  className="h-7 px-2 text-xs"
                >
                  <UploadIcon className="mr-1 h-3 w-3" />
                  上传
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={() => void handleGenerateAndAdd()}
                  disabled={draftBusy || !name.trim()}
                  className="h-7 px-2 text-xs"
                >
                  <SparklesIcon className="mr-1 h-3 w-3" />
                  {draftBusy ? "生成中…" : "AI 生成"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => addDraftFileRef.current?.click()}
                  disabled={draftBusy}
                  className="h-7 px-2 text-xs"
                >
                  <UploadIcon className="mr-1 h-3 w-3" />
                  上传
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    resetDraft();
                  }}
                  className="h-7 px-2 text-xs"
                >
                  取消
                </Button>
              </>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      <div className="col-span-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-600">
            {labels.section}
            <span className="ml-2 text-xs font-normal text-slate-400">
              第一项为{labels.primary}；主体确认时按本集画风自动选用
            </span>
          </p>
          <div className="flex items-center gap-2">
            <ToggleGroup
              type="single"
              value={genSize}
              onValueChange={(v) => v && setGenSize(v)}
              spacing={0}
            >
              <ToggleGroupItem
                value="1024x1024"
                className="px-3 py-1 text-xs data-[state=on]:bg-primary data-[state=on]:text-white"
              >
                1:1
              </ToggleGroupItem>
              <ToggleGroupItem
                value="1920x1088"
                className="px-3 py-1 text-xs data-[state=on]:bg-primary data-[state=on]:text-white"
              >
                16:9
              </ToggleGroupItem>
            </ToggleGroup>
            {!showAdd && (
              <Button
                variant="outline"
                size="sm"
                onClick={startAdd}
                disabled={draftBusy}
                className="h-7 px-2 text-xs"
              >
                + 添加{labels.unit}
              </Button>
            )}
          </div>
        </div>
        <Table className="mt-1 text-xs">
          <TableHeader className="text-slate-400">
            <TableRow>
              <TableHead className="w-14 py-1.5 pr-2 font-medium">参考图</TableHead>
              <TableHead className="w-24 py-1.5 pr-2 font-medium">{labels.name}</TableHead>
              <TableHead className="w-36 py-1.5 pr-2 font-medium">画风</TableHead>
              <TableHead className="py-1.5 pr-2 font-medium">{labels.setting}</TableHead>
              <TableHead className="py-1.5 text-right font-medium">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mode === "create" && variants.length === 0 && renderFormRow(null, false)}
            {variants.map((v, i) => renderFormRow(v, false))}
            {showAdd && renderFormRow(null, true)}
            {variants.length === 0 && mode === "edit" && !showAdd && (
              <TableRow>
                <TableCell colSpan={5} className="px-2 py-4 text-center text-slate-400">
                  暂无{labels.unit}：点击右上角「+ 添加{labels.unit}」生成或上传
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <p className="mt-1 text-xs text-slate-400">
          {mode === "create"
            ? `${labels.primary}必填：选画风、填${labels.setting}后 AI 生成或上传参考图，再保存`
            : `第一项为${labels.primary}；修改后直接点底部「保存」提交所有改动`}
        </p>
        <input
          ref={draftFileRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => void handleDraftFile(e)}
        />
        <input
          ref={addDraftFileRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => void handleDraftFileAndAdd(e)}
        />
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent
          className="sm:max-w-md"
          onPointerDownOutside={preventLightboxInteract}
          onInteractOutside={preventLightboxInteract}
          onEscapeKeyDown={preventLightboxInteract}
        >
          <DialogHeader>
            <DialogTitle>删除{labels.unit}</DialogTitle>
            <DialogDescription>
              确认删除{labels.unit}「{deleteTargetVariant?.name || "未命名"}」吗？删除后该
              {labels.unit}不再参与主体确认与生图，操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget) handleDeleteVariant(deleteTarget);
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {appearanceDialog && (
        <AppearanceDialog
          title={appearanceDialog.title}
          description={labels.appearanceHint}
          initial={appearanceDialog.initial}
          placeholder={labels.appearancePlaceholder}
          onClose={() => setAppearanceCtx(null)}
          onSave={(value) => handleAppearanceSave(value)}
        />
      )}
    </>
  );
}
