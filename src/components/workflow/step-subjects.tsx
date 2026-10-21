"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AiFeed } from "@/components/ai-feed";
import { AssetPicker } from "./asset-picker";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SaveAssetModal,
  buildSavePrefill,
  type SaveTarget,
} from "@/components/workflow/save-asset-modal";
import { SubjectRow, type SubjectSource } from "@/components/workflow/subject-card";
import {
  SubjectPromptModal,
  type SubjectPromptTarget,
} from "@/components/workflow/subject-prompt-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { restoreFeedFromEvents } from "@/lib/ai-feed-restore";
import {
  api,
  isTaskReferences,
  type AssetSummary,
  type SubjectBindings,
  type TaskDetail,
} from "@/lib/api";
import { useSubjectRegeneration } from "@/lib/use-subject-regeneration";
import { useAiStream, type SseEvent } from "@/lib/use-ai-stream";

type LiveSubject = {
  kind: "style" | "scene" | "character";
  index?: number;
  source: SubjectSource;
  name: string;
  image: string | null;
};

/** 步骤 3：主体确认 —— 顶部「AI 过程」独立成行；每个主体一行（左选择 / 右回显），支持重新生成、存为资产、删除。 */
export function StepSubjects({
  taskId,
  task,
  onStreamingChange,
}: {
  taskId: string;
  task: TaskDetail | null;
  onStreamingChange: (streaming: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [bindings, setBindings] = useState<SubjectBindings | null>(null);
  const [live, setLive] = useState<LiveSubject[]>([]);
  const [matching, setMatching] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saveTarget, setSaveTarget] = useState<SaveTarget | null>(null);
  const [promptTarget, setPromptTarget] = useState<SubjectPromptTarget | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<{
    index: number;
    name: string;
    assetId: string;
  } | null>(null);
  const [promoting, setPromoting] = useState(false);
  const pendingPromoteRef = useRef<number | null>(null);

  const seriesCtx = task?.series ?? null;
  const protoAssetIds = useMemo(
    () => new Set((seriesCtx?.protagonists ?? []).map((p) => p.id)),
    [seriesCtx],
  );
  const isCharLocked = (assetId: string | null) => !!assetId && protoAssetIds.has(assetId);

  const matchedRef = useRef(false);

  const { data: assetsData } = useQuery({
    queryKey: ["assets", "all-for-subjects"],
    queryFn: () => api.getAssets(),
    retry: false,
  });
  const assets = assetsData?.assets ?? [];

  const { data: eventsData } = useQuery({
    queryKey: ["events", taskId],
    queryFn: () => api.getEvents(taskId),
    retry: false,
    staleTime: 30_000,
  });
  const byType = useMemo(() => {
    const grouped: Record<AssetSummary["type"], AssetSummary[]> = {
      character: [],
      scene: [],
      style: [],
    };
    for (const a of assets) grouped[a.type].push(a);
    return grouped;
  }, [assets]);
  /** 画风候选：有合集时仅限该合集内的画风（剧集创建时已选中的本集画风为默认值） */
  const styleOptions = useMemo(
    () =>
      seriesCtx
        ? byType.style.filter((a) => (seriesCtx.styles ?? []).some((s) => s.id === a.id))
        : byType.style,
    [seriesCtx, byType],
  );

  const liveByKey = useMemo(() => {
    const m: Record<string, LiveSubject> = {};
    for (const s of live) {
      m[s.kind + (s.index !== undefined ? `-${s.index}` : "")] = s;
    }
    return m;
  }, [live]);

  const assetImage = (assetId: string | null | undefined) =>
    assetId ? (assets.find((a) => a.id === assetId)?.primaryImage ?? null) : null;

  /** 合集规则：画风默认本集所选（当前选择为合集内有效画风时保留）；主角角色固定为合集主角资产 */
  function applySeriesLockBindings(base: SubjectBindings | null): SubjectBindings | null {
    if (!base || !seriesCtx) return base;
    const seriesStyleIds = new Set((seriesCtx.styles ?? []).map((s) => s.id));
    const currentStyle = base.style?.assetId ?? null;
    const lockedStyleId =
      currentStyle && seriesStyleIds.size > 0 && seriesStyleIds.has(currentStyle)
        ? currentStyle
        : seriesCtx.styleAssetId || null;
    const lockedStyle = (seriesCtx.styles ?? []).find((s) => s.id === lockedStyleId);
    // Step 1: fill from episodeCast（含主角和成员）
    const castMap = new Map((seriesCtx.episodeCast ?? []).map((c) => [c.name, c.id]));
    let filled: SubjectBindings = {
      ...base,
      style: {
        ...base.style,
        assetId: lockedStyleId,
        preset: lockedStyle?.stylePreset?.trim() || base.style?.preset,
      },
      characters: (base.characters ?? []).map((c) => {
        const id = castMap.get(c.name);
        return id ? { ...c, assetId: id } : c;
      }),
    };
    // Step 2: override protagonists（保留合集主角锁定逻辑）
    filled.characters = filled.characters.map((c) => {
      const proto = (seriesCtx?.protagonists ?? []).find(
        (p) => p.name === c.name || p.name.includes(c.name) || c.name.includes(p.name),
      );
      return proto ? { ...c, assetId: proto.id } : c;
    });
    return filled;
  }

  function promoteCharacter(index: number, image: string | null) {
    const c = bindings?.characters[index];
    if (!c || !seriesCtx) return;
    if (c.assetId) {
      setPromoteTarget({ index, name: c.name, assetId: c.assetId });
      return;
    }
    if (!image) {
      toast.error("该角色还没有参考图，请先生成或选择资产后再提升为主角");
      return;
    }
    pendingPromoteRef.current = index;
    // 按名字查 refs（删除主体后活下标会与服务端 refs 错位，名字才稳）
    const pRefs = task && isTaskReferences(task.references) ? task.references : null;
    const matchedRef = pRefs ? pRefs.characters.find((r) => r.name === c.name) : null;
    const pAppearance = matchedRef ? (matchedRef.appearance ?? null) : null;
    setSaveTarget({
      type: "character",
      name: c.name,
      image,
      key: `char-${index}`,
      stylePreset: presetText,
      ...buildSavePrefill({
        kind: "character",
        name: c.name,
        preset: presetText,
        asset: null,
        appearance: pAppearance,
      }),
    });
  }

  async function confirmPromote() {
    const target = promoteTarget;
    if (!target || !seriesCtx || promoting) return;
    setPromoting(true);
    try {
      const ids = [...new Set([...seriesCtx.protagonists.map((p) => p.id), target.assetId])];
      await api.updateSeries(seriesCtx.id, { protagonistIds: ids });
      setBindings((prev) =>
        prev
          ? {
              ...prev,
              characters: prev.characters.map((ch, i) =>
                i === target.index ? { ...ch, assetId: target.assetId } : ch,
              ),
            }
          : prev,
      );
      setPromoteTarget(null);
      toast.success(`已将「${target.name}」设为合集主角`);
      void queryClient.invalidateQueries({ queryKey: ["series"] });
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "提升为主角失败");
    } finally {
      setPromoting(false);
    }
  }

  /** 手动智能匹配（可选）：调用 LLM 从资产库预填绑定；默认不自动调用 */
  const runMatch = useCallback(async () => {
    if (!taskId) return;
    setMatching(true);
    setMatchError(null);
    try {
      const r = await api.matchSubjects(taskId);
      setBindings(r.bindings);
      setEditing(true);
    } catch (err) {
      setMatchError(err instanceof Error ? err.message : "主体匹配失败");
    } finally {
      setMatching(false);
    }
  }, [taskId]);

  /** 从剧本直接构建主体清单（不调 LLM）：角色 = 出场角色去重，场景 = 首格画面；资产全部留空由用户自选 */
  function buildBindingsFromScript(script: TaskDetail["script"]): SubjectBindings | null {
    if (!script || script.panels.length === 0) return null;
    const seen = new Set<string>();
    const characters: SubjectBindings["characters"] = [];
    for (const panel of script.panels) {
      for (const raw of panel.character.split(/[,，、;；\s]+/)) {
        const name = raw.trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        characters.push({ name, assetId: null });
      }
    }
    return {
      scene: { name: script.panels[0]?.scene ?? "", assetId: null },
      characters,
    };
  }

  // 进入步骤：有既有绑定直接用；否则从剧本直接列出主体（资产由用户手动选择，不再自动 LLM 匹配）
  useEffect(() => {
    if (task === null || matchedRef.current) return;
    matchedRef.current = true;
    const base = task.subjectBindings ?? buildBindingsFromScript(task.script);
    const baseWithTaskStyle: SubjectBindings | null = base
      ? {
          ...base,
          style: {
            assetId: task.styleAssetId ?? base.style?.assetId ?? null,
            preset: base.style?.preset,
          },
        }
      : null;
    setBindings(applySeriesLockBindings(baseWithTaskStyle));
    setEditing(!!task.subjectBindings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task === null]);

  const handleSubjectEvent = useCallback((ev: SseEvent) => {
    const subj: LiveSubject = {
      kind: (ev.kind as LiveSubject["kind"]) ?? "character",
      index: typeof ev.index === "number" ? ev.index : undefined,
      source: String(ev.source ?? "generated") as SubjectSource,
      name: String(ev.name ?? ""),
      image: (ev.image as string | null) ?? null,
    };
    setLive((prev) => {
      const key = subj.kind + (subj.index !== undefined ? `-${subj.index}` : "");
      const idx = prev.findIndex(
        (s) => s.kind + (s.index !== undefined ? `-${s.index}` : "") === key,
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = subj;
        return next;
      }
      return [...prev, subj];
    });
  }, []);

  const { regenerate: regenerateSubject, isPending: subjectPending } = useSubjectRegeneration(
    taskId,
    { preset: bindings?.style?.preset, onSubject: handleSubjectEvent },
  );
  const viewPrompt = (
    target: Omit<SubjectPromptTarget, "prompt">,
    prompt: string | null | undefined,
  ) => (prompt ? () => setPromptTarget({ ...target, prompt }) : undefined);

  const { items, streaming, start, reset, restore } = useAiStream({
    doneLabel: "主体确认完成",
    onError: (message) => toast.error(message || "主体确认失败"),
    onSettled: () => {
      setEditing(true);
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void queryClient.invalidateQueries({ queryKey: ["events", taskId] });
    },
    onEvent: (ev) => {
      if (ev.type !== "subject") return false;
      handleSubjectEvent(ev);
      return true;
    },
  });

  useEffect(() => {
    onStreamingChange(streaming);
  }, [streaming, onStreamingChange]);

  // 回看恢复：本步骤最近一次 AI 运行的完整过程，从任务事件里取回
  const restoredFeed = useMemo(
    () => restoreFeedFromEvents(eventsData?.events, "subjects"),
    [eventsData],
  );
  useEffect(() => {
    if (!eventsData || streaming || items.length > 0) return;
    if (restoredFeed.length) restore(restoredFeed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsData]);
  async function confirmSubjects() {
    if (!bindings || streaming) return;
    setLive([]);
    reset();
    void start(`/api/tasks/${taskId}/subjects`, { bindings });
  }

  const setStyleAsset = (assetId: string | null) => {
    setBindings((prev) => {
      if (!prev) return prev;
      const asset = assetId ? (assets.find((a) => a.id === assetId) ?? null) : null;
      return { ...prev, style: { assetId, preset: asset?.stylePreset ?? undefined } };
    });
    // 写回任务本集画风（回看恢复 / 合集校验共用同一数据源）
    void api
      .updateTaskStyle(taskId, assetId)
      .then(() => queryClient.invalidateQueries({ queryKey: ["task", taskId] }))
      .catch(() => toast.error("本集画风保存失败"));
  };
  const setStylePreset = (preset: string) =>
    setBindings((prev) =>
      prev ? { ...prev, style: { assetId: prev.style?.assetId ?? null, preset } } : prev,
    );
  const setSceneAsset = (assetId: string | null) =>
    setBindings((prev) =>
      prev ? { ...prev, scene: { ...prev.scene, assetId, variantId: null } } : prev,
    );
  const setSceneName = (name: string) =>
    setBindings((prev) => (prev ? { ...prev, scene: { ...prev.scene, name } } : prev));
  const setSceneVariant = (variantId: string | null) =>
    setBindings((prev) => (prev ? { ...prev, scene: { ...prev.scene, variantId } } : prev));
  const setCharacterAsset = (index: number, assetId: string | null) =>
    setBindings((prev) =>
      prev
        ? {
            ...prev,
            characters: prev.characters.map((c, i) =>
              i === index ? { ...c, assetId, variantId: null } : c,
            ),
          }
        : prev,
    );
  const setCharacterVariant = (index: number, variantId: string | null) =>
    setBindings((prev) =>
      prev
        ? {
            ...prev,
            characters: prev.characters.map((c, i) => (i === index ? { ...c, variantId } : c)),
          }
        : prev,
    );
  const removeCharacter = (index: number) =>
    setBindings((prev) =>
      prev ? { ...prev, characters: prev.characters.filter((_, i) => i !== index) } : prev,
    );

  if (!task?.script) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-400">
        {matching ? "正在匹配主体库…" : "请先完成剧本创作"}
      </div>
    );
  }

  if (!bindings) {
    if (matchError) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-700">主体匹配失败</p>
          <p className="mt-1 break-words text-xs text-red-600">{matchError}</p>
          <Button size="sm" className="mt-3" disabled={matching} onClick={() => void runMatch()}>
            {matching ? "重试中…" : "重试"}
          </Button>
        </div>
      );
    }
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-400">
        {matching ? "正在匹配主体库…" : "加载中…"}
      </div>
    );
  }

  const refsNew = task && isTaskReferences(task.references) ? task.references : null;
  const styleAssetId = bindings.style?.assetId ?? null;
  /** 「自动」变体预览与后端解析优先级一致：优先显示本集画风对应的形象变体 */
  const styleVariantImage = (asset: AssetSummary | undefined) =>
    asset && styleAssetId
      ? (asset.variants.find((v) => v.styleId === styleAssetId)?.image ?? null)
      : null;
  const styleLive = liveByKey["style"];
  const styleImage = assetImage(styleAssetId) ?? styleLive?.image ?? refsNew?.style?.image ?? null;
  const styleSource: SubjectSource = styleAssetId
    ? "asset"
    : styleLive
      ? styleLive.source
      : styleImage
        ? "generated"
        : "default";

  const sceneAssetId = bindings.scene.assetId;
  const sceneAsset = sceneAssetId ? byType.scene.find((a) => a.id === sceneAssetId) : undefined;

  const defaultPreset = task?.stylePreset?.trim() || "默认画风";
  /**
   * 与 subjectPrompts / references 下标对齐的"真源"名字列表：
   * 已确认 = 服务端 refs.characters 顺序；未确认 = 剧本 uniqueCast 顺序
   * （与服务端 buildSubjectPrompts 两个分支各自一致）。
   * 本地删除角色只改 bindings，不动服务端数组，故必须用名字找回原始下标再按下标取数。
   */
  const alignedNames = (() => {
    if (refsNew) return refsNew.characters.map((c) => c.name);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of task?.script?.panels ?? []) {
      for (const raw of p.character.split(/[,，、;；\s]+/)) {
        const name = raw.trim();
        if (name && !seen.has(name)) {
          seen.add(name);
          out.push(name);
        }
      }
    }
    return out;
  })();
  const assetById = (id: string | null | undefined) =>
    id ? (assets.find((a) => a.id === id) ?? null) : null;
  const selectedStyleAsset = assetById(styleAssetId);
  const presetText =
    selectedStyleAsset?.stylePreset?.trim() || bindings.style?.preset?.trim() || defaultPreset;
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-600">AI 过程</h3>
        <AiFeed items={items} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-600">
          选择主体（左侧预览悬停可生成/重新生成、存为资产、查看提示词，右侧从资产库选择或新生成）
        </h3>
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          <SubjectRow
            label="画风"
            subject={{ name: presetText, kind: "style" }}
            options={styleOptions}
            value={styleAssetId}
            onValueChange={setStyleAsset}
            image={styleImage}
            source={styleSource}
            regenerating={subjectPending("style")}
            onRegenerate={styleAssetId ? undefined : () => void regenerateSubject("style")}
            onViewPrompt={viewPrompt(
              { kind: "style", title: "画风样图提示词" },
              task?.subjectPrompts?.style,
            )}
            newLabel={seriesCtx ? undefined : `不使用库画风（${defaultPreset}）`}
            onSave={
              styleImage
                ? () =>
                    setSaveTarget({
                      type: "style",
                      name: "画风",
                      image: styleImage!,
                      key: "style",
                      stylePreset: presetText,
                      ...buildSavePrefill({
                        kind: "style",
                        name: "画风",
                        preset: presetText,
                        asset: assetById(styleAssetId),
                      }),
                    })
                : undefined
            }
            extra={
              <div>
                <Label htmlFor="style-preset" className="mb-1 block text-xs text-slate-500">
                  画风描述（写入生图提示词，留空用默认画风）
                </Label>
                <Input
                  id="style-preset"
                  value={styleAssetId ? presetText : (bindings.style?.preset ?? "")}
                  onChange={(e) => setStylePreset(e.target.value)}
                  placeholder="如：圆润可爱的 Q 版卡通风，二头身比例，干净描边"
                  className="h-8 w-full max-w-xs text-xs"
                  disabled={!!styleAssetId}
                />
              </div>
            }
          />
          <div className="border-b border-slate-100 p-4 last:border-b-0">
            <p className="text-sm font-medium text-slate-700">主场景</p>
            <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
              <Label htmlFor="scene-name" className="mb-1 block text-xs text-slate-500">
                说明描述（仅存储/展示，留空用剧本首格画面）
              </Label>
              <Input
                id="scene-name"
                value={bindings.scene.name}
                onChange={(e) => setSceneName(e.target.value)}
                placeholder="如：古城门外，黄昏，战火未尽"
                className="h-8 w-full text-xs"
              />
              <span className="mb-1 block text-xs text-slate-500">
                场景资产参考（可选，提供场景参考图）
              </span>
              <AssetPicker
                options={byType.scene}
                value={sceneAssetId}
                onValueChange={setSceneAsset}
                newLabel="不使用库场景（不传场景参考图）"
                placeholder="不使用库场景（不传场景参考图）"
              />
              {(sceneAsset?.variants.length ?? 0) > 0 && (
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-slate-500">形象变体</span>
                  <Select
                    value={bindings.scene.variantId ?? "auto"}
                    onValueChange={(v) => setSceneVariant(v === "auto" ? null : v)}
                  >
                    <SelectTrigger size="sm" className="h-7 w-auto gap-1 text-xs">
                      <SelectValue placeholder="自动（本集画风）" />
                    </SelectTrigger>
                    <SelectContent className="text-xs">
                      <SelectItem value="auto">自动（本集画风）</SelectItem>
                      {(sceneAsset?.variants ?? []).map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name || "形象"}
                          {v.styleName ? ` · ${v.styleName}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
          {bindings.characters.map((c, i) => {
            const cAssetId = c.assetId;
            const cAsset = cAssetId ? byType.character.find((a) => a.id === cAssetId) : undefined;
            // 本地删除角色后下标 i 会重排，但服务端 subjectPrompts / references 仍按确认时下标对齐；
            // 用名字找回原始下标（-1 = 该主体尚未确认，提示词/参考图不可用）
            const origIdx = alignedNames.indexOf(c.name);
            const cLive = origIdx >= 0 ? liveByKey[`character-${origIdx}`] : undefined;
            const cVariantImage =
              c.variantId && cAsset
                ? (cAsset.variants.find((v) => v.id === c.variantId)?.image ?? null)
                : null;
            const cImage =
              cVariantImage ??
              styleVariantImage(cAsset) ??
              assetImage(cAssetId) ??
              cLive?.image ??
              refsNew?.characters[origIdx]?.image ??
              null;
            const cSource: SubjectSource = cAssetId
              ? "asset"
              : cLive
                ? cLive.source
                : refsNew?.characters[origIdx]?.image
                  ? "generated"
                  : "default";
            // 未绑定角色的 LLM 补全外观（按原始下标取 refs），存为资产时回填
            const cAppearance =
              !cAssetId && origIdx >= 0 && refsNew?.characters[origIdx]?.name === c.name
                ? (refsNew.characters[origIdx].appearance ?? null)
                : null;
            const canRegen = !cAssetId && origIdx >= 0 && !!refsNew;
            return (
              <SubjectRow
                key={i}
                label={c.name || `角色 ${i + 1}`}
                subject={{ name: c.name, kind: "character" }}
                options={byType.character}
                value={cAssetId}
                onValueChange={(id) => setCharacterAsset(i, id)}
                image={cImage}
                source={cSource}
                index={i}
                regenerating={canRegen ? subjectPending("character", origIdx) : false}
                onRegenerate={
                  canRegen ? () => void regenerateSubject("character", origIdx) : undefined
                }
                onViewPrompt={viewPrompt(
                  {
                    kind: "character",
                    index: origIdx,
                    name: c.name,
                    title: `角色「${c.name}」提示词`,
                  },
                  task?.subjectPrompts?.characters[origIdx],
                )}
                onSave={
                  cImage
                    ? () =>
                        setSaveTarget({
                          type: "character",
                          name: c.name,
                          image: cImage!,
                          key: `char-${i}`,
                          stylePreset: presetText,
                          styleId: bindings.style?.assetId ?? null,
                          styleName:
                            styleOptions.find((s) => s.id === bindings.style?.assetId)?.name ??
                            null,
                          ...buildSavePrefill({
                            kind: "character",
                            name: c.name,
                            preset: presetText,
                            asset: assetById(cAssetId),
                            appearance: cAppearance,
                          }),
                        })
                    : undefined
                }
                onDelete={() => removeCharacter(i)}
                locked={isCharLocked(cAssetId)}
                extra={
                  <>
                    {(cAsset?.variants.length ?? 0) > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-xs text-slate-500">形象变体</span>
                        <Select
                          value={c.variantId ?? "auto"}
                          onValueChange={(v) => setCharacterVariant(i, v === "auto" ? null : v)}
                        >
                          <SelectTrigger size="sm" className="h-7 w-auto gap-1 text-xs">
                            <SelectValue placeholder="自动（本集画风）" />
                          </SelectTrigger>
                          <SelectContent className="text-xs">
                            <SelectItem value="auto">自动（本集画风）</SelectItem>
                            {(cAsset?.variants ?? []).map((v) => (
                              <SelectItem key={v.id} value={v.id}>
                                {v.name || "形象"}
                                {v.styleName ? ` · ${v.styleName}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {seriesCtx && !isCharLocked(cAssetId) && (
                      <div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => promoteCharacter(i, cImage)}
                        >
                          升为合集主角
                        </Button>
                      </div>
                    )}
                  </>
                }
              />
            );
          })}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => void confirmSubjects()} disabled={streaming}>
            {streaming ? "正在解析主体…" : editing ? "重新确认主体" : "确认主体"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void runMatch()}
            disabled={streaming || matching}
            title="调用 LLM 从资产库自动预填绑定（资产库越大越慢）"
          >
            {matching ? "匹配中…" : "智能匹配"}
          </Button>
          {matchError && <span className="text-xs text-red-500">智能匹配失败：{matchError}</span>}
          <span className="text-xs text-slate-400">确认后将据此生成漫画参考图</span>
        </div>
      </div>

      {saveTarget && (
        <SaveAssetModal
          target={saveTarget}
          sourceTaskId={taskId}
          defaultSeriesId={task?.seriesId}
          onClose={() => setSaveTarget(null)}
          onSaved={(asset) => {
            const idx = pendingPromoteRef.current;
            pendingPromoteRef.current = null;
            if (idx !== null && seriesCtx) {
              setPromoteTarget({ index: idx, name: saveTarget.name, assetId: asset.id });
            }
          }}
        />
      )}

      {promptTarget && (
        <SubjectPromptModal
          taskId={taskId}
          target={promptTarget}
          onClose={() => setPromptTarget(null)}
          onRegenerate={() => regenerateSubject(promptTarget.kind, promptTarget.index)}
        />
      )}

      <Dialog open={promoteTarget !== null} onOpenChange={(o) => !o && setPromoteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>升为合集主角</DialogTitle>
            <DialogDescription>
              将「{promoteTarget?.name}」加入合集《{seriesCtx?.name}
              》的主角，之后各集固定该角色，保证跨集一致。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromoteTarget(null)}>
              取消
            </Button>
            <Button disabled={promoting} onClick={() => void confirmPromote()}>
              {promoting ? "提升中…" : "确认提升"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
