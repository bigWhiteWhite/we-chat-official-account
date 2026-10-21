"use client";

import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PreviewImage } from "@/components/photo-viewer";
import { AssetPicker } from "./asset-picker";
import { ImageActionOverlay, type ImageAction } from "./image-action-overlay";
import { ImageGenMask } from "./image-gen-mask";
import { imageSrc, type AssetSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

export type SubjectKind = "style" | "scene" | "character";
export type SubjectSource = "asset" | "generated" | "generating" | "default";

interface SubjectCardProps {
  kind: SubjectKind;
  name: string;
  image: string | null;
  source: SubjectSource;
  index?: number;
  regenerating?: boolean;
  onRegenerate?: () => void;
  onSave?: () => void;
  onDelete?: () => void;
  onViewPrompt?: () => void;
  /** 合集锁定：禁止重新生成/删除，徽标显示"合集锁定" */
  locked?: boolean;
  /** 覆盖默认宽度（默认 sm:w-36） */
  className?: string;
}

const KIND_LABEL: Record<SubjectKind, string> = {
  style: "画风",
  scene: "主场景",
  character: "角色",
};

export function SubjectCard({
  kind,
  name,
  image,
  source,
  index,
  regenerating = false,
  onRegenerate,
  onSave,
  onDelete,
  onViewPrompt,
  locked = false,
  className = "",
}: SubjectCardProps) {
  const kindLabel =
    kind === "character" && index !== undefined ? `角色 ${index + 1}` : KIND_LABEL[kind];

  const sourceLabel =
    source === "asset"
      ? "库"
      : source === "generating"
        ? "生成中"
        : source === "default"
          ? "默认"
          : "新";
  const badgeVariant = source === "asset" ? "secondary" : "outline";

  const busy = regenerating || source === "generating";
  const actions: ImageAction[] = [];
  if (onRegenerate) {
    actions.push({
      key: "regenerate",
      label: image ? "重新生成" : "生成此格",
      onClick: onRegenerate,
      disabled: regenerating,
    });
  }
  if (onSave && image) actions.push({ key: "save", label: "存为资产", onClick: onSave });
  if (onViewPrompt) actions.push({ key: "prompt", label: "查看提示词", onClick: onViewPrompt });
  if (onDelete) {
    actions.push({ key: "delete", label: "删除", onClick: onDelete, variant: "destructive" });
  }
  const hasActions = !locked && actions.length > 0;

  return (
    <div
      className={cn(
        "group relative w-full sm:w-36 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md",
        className,
      )}
    >
      <div className="relative flex aspect-square items-center justify-center bg-slate-50">
        {image ? (
          <PreviewImage src={imageSrc(image)} alt={name} className="h-full w-full object-cover" />
        ) : busy ? (
          <ImageGenMask />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2">
            <Skeleton className="h-6 w-6" />
            <span className="text-xs text-slate-400">无图</span>
          </div>
        )}
        {/* 已有图且生成/重生成中：遮罩叠加在图片上（无图时上面已直接渲染遮罩） */}
        {image && busy && <ImageGenMask />}
        {hasActions && <ImageActionOverlay actions={actions} direction="column" />}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
        <span
          className="truncate text-sm font-medium text-slate-700"
          title={`${kindLabel}：${name || "—"}`}
        >
          {name || "—"}
        </span>
        {locked ? (
          <Badge className="shrink-0 bg-amber-100 text-[10px] text-amber-700 hover:bg-amber-100">
            合集锁定
          </Badge>
        ) : (
          <Badge variant={badgeVariant} className="shrink-0 text-[10px]">
            {sourceLabel}
          </Badge>
        )}
      </div>
    </div>
  );
}

interface SubjectRowProps {
  label: string;
  subject: { name: string; kind: SubjectKind };
  options: AssetSummary[];
  value: string | null;
  onValueChange: (assetId: string | null) => void;
  image: string | null;
  source: SubjectSource;
  index?: number;
  regenerating?: boolean;
  onRegenerate?: () => void;
  onSave?: () => void;
  onDelete?: () => void;
  onViewPrompt?: () => void;
  newLabel?: string;
  /** 合集锁定：选择器替换为只读框，禁止改动 */
  locked?: boolean;
  /** 选择器下方的扩展控件（画风描述输入、形象变体、操作按钮等） */
  extra?: ReactNode;
}

/** 主体确认行：左预览卡（悬停可操作）+ 右侧名称 / 选择器 / 扩展控件 */
export function SubjectRow({
  label,
  subject,
  options,
  value,
  onValueChange,
  image,
  source,
  index,
  regenerating,
  onRegenerate,
  onSave,
  onDelete,
  onViewPrompt,
  newLabel = "新生成 / 不使用库主体",
  locked = false,
  extra,
}: SubjectRowProps) {
  const lockedName =
    locked && value ? (options.find((a) => a.id === value)?.name ?? "已锁定资产") : "";
  return (
    <div className="flex flex-col gap-3 border-b border-slate-100 p-4 last:border-b-0 sm:flex-row sm:items-start">
      <SubjectCard
        kind={subject.kind}
        name={subject.name}
        image={image}
        source={source}
        index={index}
        regenerating={regenerating}
        onRegenerate={onRegenerate}
        onSave={onSave}
        onDelete={onDelete}
        onViewPrompt={onViewPrompt}
        locked={locked}
        className="w-40 sm:w-40"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {locked ? (
          <div className="flex h-9 items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3">
            <span className="truncate text-sm text-amber-800">{lockedName || "合集锁定"}</span>
            <span className="ml-2 shrink-0 text-[10px] text-amber-600">不可更改</span>
          </div>
        ) : (
          <div className="w-full max-w-xs">
            <AssetPicker
              options={options}
              value={value}
              onValueChange={onValueChange}
              newLabel={newLabel}
              placeholder={newLabel}
            />
          </div>
        )}
        {extra}
      </div>
    </div>
  );
}
