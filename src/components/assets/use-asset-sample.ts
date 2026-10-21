"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";

import { api, type AssetType } from "@/lib/api";

/** 画风样图（仅 style 类型）的本地状态与操作 */
export function useAssetSample(opts: {
  type: AssetType;
  name: string;
  stylePreset: string;
  size?: string;
}) {
  const { type, name, stylePreset, size } = opts;

  const [generating, setGenerating] = useState(false);
  const [base64, setBase64] = useState<string | null>(null);
  const [mime, setMime] = useState("image/png");
  const [removed, setRemoved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const canGenerate = !generating && name.trim().length > 0 && stylePreset.trim().length > 0;

  async function generate() {
    if (generating || !name.trim() || !stylePreset.trim()) return;
    setGenerating(true);
    try {
      const res = await api.generateAssetPreview({
        type,
        name: name.trim(),
        stylePreset: stylePreset.trim(),
        size,
      });
      setBase64(res.imageBase64);
      setMime(res.mimeType);
      setRemoved(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const fileBase64 = dataUrl.split(",")[1];
      if (fileBase64) {
        setBase64(fileBase64);
        setMime(file.type === "image/jpeg" ? "image/jpeg" : "image/png");
        setRemoved(false);
      }
    };
    reader.onerror = () => toast.error("图片读取失败");
    reader.readAsDataURL(file);
  }

  function remove() {
    setBase64(null);
    setRemoved(true);
  }

  /** 类型切换（新建模式）时清空样图 */
  function resetSample() {
    setBase64(null);
    setRemoved(false);
  }

  return {
    base64,
    mime,
    removed,
    generating,
    canGenerate,
    fileRef,
    generate,
    onFile,
    remove,
    resetSample,
  };
}

export type AssetSample = ReturnType<typeof useAssetSample>;
