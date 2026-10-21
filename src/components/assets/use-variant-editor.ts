"use client";
import { useUiStore } from "@/store/ui";

import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";

import { api, bustImageCache, type AssetSummary } from "@/lib/api";

import { VARIANT_LABELS, type VariantKind } from "./variant-labels";

export type Variant = {
  id: string;
  name: string;
  styleId: string;
  styleName: string;
  appearance: string;
  image: string;
};

type VariantDraft = {
  styleId: string;
  name: string;
  appearance: string;
  imageBase64: string | null;
  mime: string;
};

const EMPTY_DRAFT: VariantDraft = {
  styleId: "",
  name: "",
  appearance: "",
  imageBase64: null,
  mime: "image/png",
};

export type StyleOption = AssetSummary;

type PendingNewData = {
  name: string;
  styleId: string;
  appearance: string;
  imageBase64: string | undefined;
  mimeType: "image/png" | "image/jpeg" | undefined;
};

type PendingRegen = {
  imageBase64: string;
  mime: "image/png" | "image/jpeg";
};

export function useVariantEditor(opts: {
  mode: "create" | "edit";
  asset?: AssetSummary;
  kind: VariantKind;
  name: string;
  variantStyleOptions: StyleOption[];
}) {
  const { mode, asset, kind, name, variantStyleOptions } = opts;
  const labels = VARIANT_LABELS[kind];

  const [variants, setVariants] = useState<Variant[]>(asset?.variants ?? []);
  const [draft, setDraft] = useState<VariantDraft>({
    ...EMPTY_DRAFT,
    styleId: asset?.variants[0]?.styleId ?? "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [regenBusyIds, setRegenBusyIds] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const genSize = useUiStore((s) => s.genSize);
  const setGenSize = useUiStore((s) => s.setGenSize);
  const [appearanceCtx, setAppearanceCtx] = useState<
    { kind: "form" } | { kind: "display"; variantId: string } | null
  >(null);
  const draftFileRef = useRef<HTMLInputElement>(null);
  const addDraftFileRef = useRef<HTMLInputElement>(null);
  const savedDraftRef = useRef<VariantDraft | null>(null);
  const deleteTargetVariant =
    deleteTarget !== null ? (variants.find((v) => v.id === deleteTarget) ?? null) : null;

  // 本地追踪数据（供 commitLocalChanges 提交到服务端）
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const [pendingPrimaryId, setPendingPrimaryId] = useState<string | null>(null);
  const pendingNewRef = useRef<Map<string, PendingNewData>>(new Map());
  const pendingRegenRef = useRef<Map<string, PendingRegen>>(new Map());
  const variantsRef = useRef(variants);
  variantsRef.current = variants;

  function resetDraft() {
    if (savedDraftRef.current) {
      setDraft(savedDraftRef.current);
      savedDraftRef.current = null;
    } else {
      setDraft({ ...EMPTY_DRAFT, styleId: mode === "create" ? draft.styleId : "" });
    }
    setEditingId(null);
    setShowAdd(false);
  }

  function startAdd() {
    savedDraftRef.current = { ...draft };
    const primary = variants[0];
    setDraft({
      ...EMPTY_DRAFT,
      styleId: primary?.styleId ?? (mode === "create" ? draft.styleId : ""),
      appearance: primary?.appearance ?? (mode === "create" ? draft.appearance : ""),
    });
    setEditingId(null);
    setShowAdd(true);
  }

  function handleFieldChange(id: string, field: "name" | "styleId", value: string) {
    setVariants((prev) =>
      prev.map((v) =>
        v.id === id
          ? {
              ...v,
              ...(field === "styleId"
                ? {
                    styleId: value,
                    styleName: variantStyleOptions.find((s) => s.id === value)?.name || v.styleName,
                  }
                : { [field]: value }),
            }
          : v,
      ),
    );
    if (!id.startsWith("new_")) {
      setDirtyIds((prev) => new Set(prev).add(id));
    }
  }

  async function handleVariantRegen(id: string) {
    if (regenBusyIds.has(id)) return;
    const v = variants.find((x) => x.id === id);
    if (!v) return;
    setRegenBusyIds((prev) => new Set(prev).add(id));
    try {
      const st = variantStyleOptions.find((s) => s.id === v.styleId);
      const res = await api.generateAssetPreview({
        type: kind,
        name: name.trim(),
        imagePrompt: v.appearance.trim() || undefined,
        stylePreset: st?.stylePreset?.trim() || undefined,
        size: genSize,
      });
      const dataUrl = `data:${res.mimeType};base64,${res.imageBase64}`;
      setVariants((prev) => prev.map((x) => (x.id === id ? { ...x, image: dataUrl } : x)));
      if (!id.startsWith("new_")) {
        setDirtyIds((prev) => new Set(prev).add(id));
        pendingRegenRef.current.set(id, {
          imageBase64: res.imageBase64,
          mime: res.mimeType as "image/png" | "image/jpeg",
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成失败");
    } finally {
      setRegenBusyIds((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  }

  function handleVariantFile(id: string, e: ChangeEvent<HTMLInputElement>) {
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
      const base64 = dataUrl.split(",")[1];
      if (!base64) return;
      const mime = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
      const finalUrl = `data:${mime};base64,${base64}`;
      setVariants((prev) => prev.map((v) => (v.id === id ? { ...v, image: finalUrl } : v)));
      if (!id.startsWith("new_")) {
        setDirtyIds((prev) => new Set(prev).add(id));
        pendingRegenRef.current.set(id, {
          imageBase64: base64,
          mime: mime as "image/png" | "image/jpeg",
        });
      }
    };
    reader.onerror = () => toast.error("图片读取失败");
    reader.readAsDataURL(file);
  }

  function handleEditVariant(id: string) {
    const v = variants.find((x) => x.id === id);
    if (!v) return;
    setShowAdd(false);
    setEditingId(id);
    setDraft({
      styleId: v.styleId,
      name: v.name,
      appearance: v.appearance,
      imageBase64: null,
      mime: v.image.endsWith(".jpg") ? "image/jpeg" : "image/png",
    });
  }

  function handleSaveVariant() {
    if (!asset || !editingId) return;
    const newName = draft.name.trim();
    const newStyleId = draft.styleId;
    const newAppearance = draft.appearance.trim();
    const newImage = draft.imageBase64
      ? (`data:${draft.mime};base64,${draft.imageBase64}` as string)
      : null;

    setVariants((prev) =>
      prev.map((v) =>
        v.id === editingId
          ? {
              ...v,
              name: newName || v.name,
              styleId: newStyleId || v.styleId,
              styleName: variantStyleOptions.find((s) => s.id === newStyleId)?.name || v.styleName,
              appearance: newAppearance,
              image: newImage ?? v.image,
            }
          : v,
      ),
    );

    setDirtyIds((prev) => new Set(prev).add(editingId));
    if (draft.imageBase64) {
      pendingRegenRef.current.set(editingId, {
        imageBase64: draft.imageBase64,
        mime: draft.mime as "image/png" | "image/jpeg",
      });
    }
    resetDraft();
  }

  function handleAppearanceSave(value: string) {
    const text = value.trim();
    if (appearanceCtx?.kind === "display") {
      setVariants((prev) =>
        prev.map((v) => (v.id === appearanceCtx.variantId ? { ...v, appearance: text } : v)),
      );
      setDirtyIds((prev) => new Set(prev).add(appearanceCtx.variantId));
    } else {
      setDraft((d) => ({ ...d, appearance: text }));
    }
    setAppearanceCtx(null);
  }

  async function handleGenerateVariant() {
    if (draftBusy || !name.trim()) return;
    setDraftBusy(true);
    try {
      const st = variantStyleOptions.find((s) => s.id === draft.styleId);
      const res = await api.generateAssetPreview({
        type: kind,
        name: name.trim(),
        imagePrompt: draft.appearance.trim() || undefined,
        stylePreset: st?.stylePreset?.trim() || undefined,
        size: genSize,
      });
      setDraft((d) => ({ ...d, imageBase64: res.imageBase64, mime: res.mimeType }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成失败");
    } finally {
      setDraftBusy(false);
    }
  }

  function handleDraftFile(e: ChangeEvent<HTMLInputElement>) {
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
      const base64 = dataUrl.split(",")[1];
      if (!base64) return;
      const mime = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
      setDraft((d) => ({ ...d, imageBase64: base64, mime }));
    };
    reader.onerror = () => toast.error("图片读取失败");
    reader.readAsDataURL(file);
  }

  async function handleGenerateAndAdd() {
    if (draftBusy || !name.trim() || !asset) return;
    const currentName = draft.name.trim();
    const currentStyleId = draft.styleId;
    const currentAppearance = draft.appearance.trim();

    setDraftBusy(true);
    try {
      const st = variantStyleOptions.find((s) => s.id === currentStyleId);
      const res = await api.generateAssetPreview({
        type: kind,
        name: name.trim(),
        imagePrompt: currentAppearance || undefined,
        stylePreset: st?.stylePreset?.trim() || undefined,
        size: genSize,
      });

      const tempId = `new_${Date.now()}`;
      const dataUrl = `data:${res.mimeType};base64,${res.imageBase64}`;

      pendingNewRef.current.set(tempId, {
        name: currentName,
        styleId: currentStyleId,
        appearance: currentAppearance,
        imageBase64: res.imageBase64,
        mimeType: res.mimeType as "image/png" | "image/jpeg",
      });

      setVariants((prev) => [
        ...prev,
        {
          id: tempId,
          name: currentName || "未命名",
          styleId: currentStyleId,
          styleName: variantStyleOptions.find((s) => s.id === currentStyleId)?.name || "",
          appearance: currentAppearance,
          image: dataUrl,
        },
      ]);

      resetDraft();
      setShowAdd(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成失败");
    } finally {
      setDraftBusy(false);
    }
  }

  function handleDraftFileAndAdd(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !asset) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }

    const currentName = draft.name.trim();
    const currentStyleId = draft.styleId;
    const currentAppearance = draft.appearance.trim();

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const base64 = dataUrl.split(",")[1];
      if (!base64) return;
      const mime = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
      const tempId = `new_${Date.now()}`;

      pendingNewRef.current.set(tempId, {
        name: currentName,
        styleId: currentStyleId,
        appearance: currentAppearance,
        imageBase64: base64,
        mimeType: mime as "image/png" | "image/jpeg",
      });

      setVariants((prev) => [
        ...prev,
        {
          id: tempId,
          name: currentName || "未命名",
          styleId: currentStyleId,
          styleName: variantStyleOptions.find((s) => s.id === currentStyleId)?.name || "",
          appearance: currentAppearance,
          image: `data:${mime};base64,${base64}`,
        },
      ]);

      resetDraft();
      setShowAdd(false);
    };
    reader.onerror = () => toast.error("图片读取失败");
    reader.readAsDataURL(file);
  }

  function handleAddVariant() {
    if (!asset) return;
    const tempId = `new_${Date.now()}`;
    const dataUrl = draft.imageBase64
      ? (`data:${draft.mime};base64,${draft.imageBase64}` as string)
      : "";

    pendingNewRef.current.set(tempId, {
      name: draft.name.trim(),
      styleId: draft.styleId,
      appearance: draft.appearance.trim(),
      imageBase64: draft.imageBase64 ?? undefined,
      mimeType: draft.imageBase64 ? (draft.mime as "image/png" | "image/jpeg") : undefined,
    });

    setVariants((prev) => [
      ...prev,
      {
        id: tempId,
        name: draft.name.trim() || "未命名",
        styleId: draft.styleId,
        styleName: variantStyleOptions.find((s) => s.id === draft.styleId)?.name || "",
        appearance: draft.appearance.trim(),
        image: dataUrl,
      },
    ]);
    resetDraft();
    setShowAdd(false);
  }

  function handleDeleteVariant(id: string) {
    if (!id.startsWith("new_")) {
      setPendingDeletes((prev) => new Set(prev).add(id));
    }
    setVariants((prev) => prev.filter((v) => v.id !== id));
    if (editingId === id) resetDraft();
    setDeleteTarget(null);
  }

  function handleSetPrimary(id: string) {
    setPendingPrimaryId(id);
    setVariants((prev) => {
      const idx = prev.findIndex((v) => v.id === id);
      if (idx <= 0) return prev;
      const item = prev[idx];
      const next = [...prev];
      next.splice(idx, 1);
      next.unshift(item);
      return next;
    });
  }

  async function commitLocalChanges(assetId: string): Promise<void> {
    const currentVariants = variantsRef.current;

    // 如果添加表单开着且有内容，先自动提交到本地待处理队列
    if (showAdd && (draft.imageBase64 || draft.name.trim() || draft.appearance.trim())) {
      const tempId = `new_${Date.now()}`;
      pendingNewRef.current.set(tempId, {
        name: draft.name.trim(),
        styleId: draft.styleId,
        appearance: draft.appearance.trim(),
        imageBase64: draft.imageBase64 ?? undefined,
        mimeType: draft.imageBase64 ? (draft.mime as "image/png" | "image/jpeg") : undefined,
      });
    }

    // 将 new_ 变体的最新编辑同步到 pendingNewRef（名称/画风/外观设定已在本地 variants 中更新）
    for (const id of dirtyIds) {
      if (!id.startsWith("new_")) continue;
      const v = currentVariants.find((x) => x.id === id);
      if (!v) continue;
      const existing = pendingNewRef.current.get(id);
      pendingNewRef.current.set(id, {
        name: v.name || existing?.name || "",
        styleId: v.styleId || existing?.styleId || "",
        appearance: v.appearance || existing?.appearance || "",
        imageBase64: existing?.imageBase64,
        mimeType: existing?.mimeType,
      });
      const regenData = pendingRegenRef.current.get(id);
      if (regenData) {
        pendingNewRef.current.set(id, {
          ...pendingNewRef.current.get(id)!,
          imageBase64: regenData.imageBase64,
          mimeType: regenData.mime,
        });
      }
    }

    for (const [, data] of pendingNewRef.current) {
      await api.addAssetVariant(assetId, {
        name: data.name || undefined,
        styleId: data.styleId || undefined,
        appearance: data.appearance || undefined,
        imageBase64: data.imageBase64,
        mimeType: data.mimeType,
      });
    }
    pendingNewRef.current.clear();

    for (const id of pendingDeletes) {
      await api.deleteAssetVariant(assetId, id);
    }
    setPendingDeletes(new Set());

    for (const id of dirtyIds) {
      if (id.startsWith("new_")) continue;
      const v = currentVariants.find((x) => x.id === id);
      if (!v) continue;
      const regen = pendingRegenRef.current.get(id);
      await api.updateAssetVariant(assetId, id, {
        name: v.name || undefined,
        styleId: v.styleId || undefined,
        appearance: v.appearance || undefined,
        ...(regen
          ? { imageBase64: regen.imageBase64, mimeType: regen.mime }
          : { regenerate: false }),
      });
    }
    setDirtyIds(new Set());
    pendingRegenRef.current.clear();

    if (pendingPrimaryId) {
      await api.updateAssetVariant(assetId, pendingPrimaryId, { setPrimary: true });
      setPendingPrimaryId(null);
    }
    // 变体图按原路径覆盖写入，递增版本号避免浏览器展示旧图
    bustImageCache();
  }

  return {
    variants,
    genSize,
    setGenSize,
    draft,
    setDraft,
    editingId,
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
    startAdd,
    resetDraft,
    handleEditVariant,
    handleFieldChange,
    handleVariantRegen,
    handleVariantFile,
    handleSaveVariant,
    handleAppearanceSave,
    handleGenerateVariant,
    handleDraftFile,
    handleAddVariant,
    handleDeleteVariant,
    handleSetPrimary,
    handleGenerateAndAdd,
    handleDraftFileAndAdd,
    addDraftFileRef,
    commitLocalChanges,
  };
}

export type VariantEditor = ReturnType<typeof useVariantEditor>;
