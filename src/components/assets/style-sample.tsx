"use client";

import { ImageOffIcon, SparklesIcon, UploadIcon } from "lucide-react";

import { PreviewImage } from "@/components/photo-viewer";
import { ImageGenMask } from "@/components/workflow/image-gen-mask";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { imageSrc } from "@/lib/api";

import type { AssetSample } from "./use-asset-sample";

/** 画风样图区：预览 + AI 生成 / 本地上传 / 移除（生成中叠加 ImageGenMask，与主体卡、分格一致） */
export function StyleSample({
  sample,
  assetImage,
  genSize,
  setGenSize,
}: {
  sample: AssetSample;
  assetImage: string | null;
  genSize: string;
  setGenSize: (size: string) => void;
}) {
  const { base64, mime, removed, generating, canGenerate, fileRef } = sample;
  const previewSrc = base64
    ? `data:${mime};base64,${base64}`
    : assetImage && !removed
      ? imageSrc(assetImage)
      : null;

  return (
    <div className="col-span-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-600">样图</p>
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
      </div>
      <div className="mt-1 flex items-start gap-3">
        <div className="relative h-24 w-24 overflow-hidden rounded-sm">
          {previewSrc ? (
            <PreviewImage
              src={previewSrc}
              alt={base64 ? "样图预览" : "样图"}
              className="h-24 w-24 rounded-sm border border-slate-200 object-cover"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-sm bg-slate-100 text-xs text-slate-400">
              无图
            </div>
          )}
          {generating && <ImageGenMask label="生成中" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void sample.generate()}
            disabled={!canGenerate}
            className="h-8 px-2 text-xs"
          >
            <SparklesIcon className="mr-1 h-3 w-3" />
            {generating ? "生成中…" : "AI 生成"}
          </Button>
          <Button
            variant="outline"
            onClick={() => fileRef.current?.click()}
            className="h-8 px-2 text-xs"
          >
            <UploadIcon className="mr-1 h-3 w-3" />
            本地上传
          </Button>
          {previewSrc && (
            <Button
              variant="outline"
              onClick={sample.remove}
              className="h-8 px-2 text-xs text-red-500"
            >
              <ImageOffIcon className="mr-1 h-3 w-3" />
              移除
            </Button>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => sample.onFile(e)}
      />
    </div>
  );
}
