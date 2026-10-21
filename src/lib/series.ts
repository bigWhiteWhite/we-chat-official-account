import { db } from "./db";
import { assetAppearance, assetPrimaryImage, getAsset, type AssetRow } from "./assets";
import type { SubjectBindings } from "@/pipeline/subjects";

/** 资产在合集中的角色：protagonist 主角(锁定) / scene 常设场景 / style 画风(锁定) / member 普通成员(仅归档) */
export type AssetSeriesRole = "protagonist" | "scene" | "style" | "member";

export const ASSET_SERIES_ROLES: AssetSeriesRole[] = ["protagonist", "scene", "style", "member"];

export type SeriesProtagonistInfo = {
  id: string;
  name: string;
  imagePrompt: string;
  keywords: string;
  image: string | null;
  characterProfile: string;
  personality: string;
  traits: string;
};

export type SeriesRecentEpisode = {
  episodeNo: number;
  title: string;
  digest: string;
};

export type SeriesStyleInfo = {
  id: string;
  name: string;
  image: string | null;
  stylePreset: string | null;
};

/** 内容标签引用：description 即 LLM 行为说明书，注入选题/剧本 prompt */
export type TagInfo = {
  id: string;
  name: string;
  description: string;
};

export type SeriesContext = {
  id: string;
  name: string;
  intro: string;
  /** 合集中全部画风资产（有序，第一个为默认） */
  styles: SeriesStyleInfo[];
  /** 本集选中的画风（task.styleAssetId 未设置时回落到第一个） */
  styleAssetId: string;
  styleName: string | null;
  stylePreset: string | null;
  styleImage: string | null;
  protagonists: SeriesProtagonistInfo[];
  /** 本集出场角色（task.castIdsJson 指定；空=全部主角） */
  episodeCast?: SeriesProtagonistInfo[];
  scenes: Array<{ id: string; name: string }>;
  recentEpisodes: SeriesRecentEpisode[];
};

/** 按资产类型推断默认角色：角色→主角，场景→场景，画风→画风 */
export function inferAssetSeriesRole(type: string): AssetSeriesRole {
  if (type === "style") return "style";
  if (type === "scene") return "scene";
  return "protagonist";
}

export type SeriesLinkEntry = { assetId: string; role: AssetSeriesRole };

type SeriesAssetLinks = {
  styleIds: string[];
  protagonistIds: string[];
  sceneAssetIds: string[];
  memberAssetIds: string[];
  assetsById: Map<string, AssetRow>;
};

function normalizeRole(assetType: string, role: string): AssetSeriesRole {
  if (role === "protagonist" || role === "scene" || role === "style" || role === "member")
    return role;
  return inferAssetSeriesRole(assetType);
}

/** 读取合集的全部资产关联（AssetSeriesLink）并按角色分组，附带资产快照 */
export async function getSeriesAssetLinks(seriesId: string): Promise<SeriesAssetLinks> {
  const links = await db.assetSeriesLink.findMany({ where: { seriesId } });
  const result: SeriesAssetLinks = {
    styleIds: [],
    protagonistIds: [],
    sceneAssetIds: [],
    memberAssetIds: [],
    assetsById: new Map(),
  };
  if (links.length === 0) return result;
  const ids = [...new Set(links.map((l) => l.assetId))];
  const assets = await Promise.all(ids.map((id) => getAsset(id)));
  for (const link of links) {
    const a = assets.find((x) => x?.id === link.assetId) ?? null;
    if (!a) continue;
    result.assetsById.set(a.id, a);
    const role = normalizeRole(a.type, link.role);
    if (role === "style") {
      result.styleIds.push(a.id);
    } else if (role === "protagonist") {
      result.protagonistIds.push(a.id);
    } else if (role === "scene") {
      result.sceneAssetIds.push(a.id);
    } else {
      result.memberAssetIds.push(a.id);
    }
  }
  return result;
}

/** 整替某合集的资产关联（新建合集 / 编辑表单全量重选时调用）；画风关联由调用方自行保留或重建 */
export async function replaceSeriesLinks(
  seriesId: string,
  entries: SeriesLinkEntry[],
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.assetSeriesLink.deleteMany({ where: { seriesId } });
    const rows = entries
      .filter((e) => e.assetId)
      .map((e) => ({ assetId: e.assetId, seriesId, role: e.role }));
    if (rows.length > 0) await tx.assetSeriesLink.createMany({ data: rows });
  });
}

/** 整替某资产的所有合集关联（资产编辑器「所属合集」多选时调用） */
export async function replaceAssetLinks(
  assetId: string,
  entries: Array<{ seriesId: string; role: AssetSeriesRole }>,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.assetSeriesLink.deleteMany({ where: { assetId } });
    const rows = entries
      .filter((e) => e.seriesId)
      .map((e) => ({ assetId, seriesId: e.seriesId, role: e.role }));
    if (rows.length > 0) await tx.assetSeriesLink.createMany({ data: rows });
  });
}

/** 读取某资产的合集归属（资产库徽章 / 目录树 / 编辑器回显） */
export async function getAssetSeriesLinks(assetId: string) {
  const links = await db.assetSeriesLink.findMany({
    where: { assetId },
    include: { series: { select: { id: true, name: true } } },
  });
  return links
    .filter((l) => !!l.series)
    .map((l) => ({
      seriesId: l.series!.id,
      seriesName: l.series!.name,
      role: l.role as AssetSeriesRole,
    }));
}

/** 读取某任务的合集上下文（无合集返回 null）。carryContext 为真时附带最近 3 集简介 */
export async function getSeriesContextForTask(task: {
  taskId: string;
  seriesId: string | null;
  carryContext: boolean;
  episodeNo: number | null;
  castIdsJson?: string | null;
  styleAssetId?: string | null;
}): Promise<SeriesContext | null> {
  if (!task.seriesId) return null;
  const series = await db.series.findUnique({ where: { id: task.seriesId } });
  if (!series) return null;

  const linked = await getSeriesAssetLinks(series.id);

  const protagonists: SeriesProtagonistInfo[] = linked.protagonistIds
    .map((id) => linked.assetsById.get(id))
    .filter((a): a is AssetRow => !!a && a.type === "character")
    .map((a) => ({
      id: a.id,
      name: a.name,
      imagePrompt: assetAppearance(a),
      keywords: a.keywords,
      image: assetPrimaryImage(a),
      characterProfile: a.characterProfile,
      personality: a.personality,
      traits: a.traits,
    }));

  const scenes: Array<{ id: string; name: string }> = linked.sceneAssetIds
    .map((id) => linked.assetsById.get(id))
    .filter((a): a is AssetRow => !!a && a.type === "scene")
    .map((a) => ({ id: a.id, name: a.name }));

  const styleAssets = linked.styleIds
    .map((sid) => linked.assetsById.get(sid))
    .filter((a): a is AssetRow => !!a && a.type === "style");
  const style =
    (task.styleAssetId && styleAssets.find((a) => a.id === task.styleAssetId)) ||
    styleAssets[0] ||
    null;

  const recentEpisodes: SeriesRecentEpisode[] = [];
  if (task.carryContext) {
    const prev = await db.task.findMany({
      where: { seriesId: series.id, taskId: { not: task.taskId } },
      orderBy: { episodeNo: "desc" },
      take: 3,
      select: { episodeNo: true, title: true, episodeDigest: true, scriptJson: true },
    });
    for (const p of prev) {
      if (p.episodeNo == null) continue;
      let title = p.title ?? "";
      if (!title && p.scriptJson) {
        try {
          title = (JSON.parse(p.scriptJson) as { title?: string }).title ?? "";
        } catch {
          title = "";
        }
      }
      recentEpisodes.push({ episodeNo: p.episodeNo, title, digest: p.episodeDigest ?? "" });
    }
    recentEpisodes.sort((a, b) => a.episodeNo - b.episodeNo);
  }

  /** 本集出场角色：task.castIdsJson 指定时按所选角色（须为合集中的角色资产），否则为空（=全部主角） */
  let castIds: string[] = [];
  if (task.castIdsJson) {
    try {
      const parsed: unknown = JSON.parse(task.castIdsJson);
      if (Array.isArray(parsed)) castIds = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      castIds = [];
    }
  }
  const episodeCast: SeriesProtagonistInfo[] = castIds.length
    ? castIds
        .map((id) => linked.assetsById.get(id))
        .filter((a): a is AssetRow => !!a && a.type === "character")
        .map((a) => ({
          id: a.id,
          name: a.name,
          imagePrompt: assetAppearance(a),
          keywords: a.keywords,
          image: assetPrimaryImage(a),
          characterProfile: a.characterProfile,
          personality: a.personality,
          traits: a.traits,
        }))
    : [];

  return {
    id: series.id,
    name: series.name,
    intro: series.intro,
    styles: styleAssets.map((a) => ({
      id: a.id,
      name: a.name,
      image: a.imagePaths[0] ?? null,
      stylePreset: a.stylePreset,
    })),
    styleAssetId: style?.id ?? "",
    styleName: style?.name ?? null,
    stylePreset: style?.stylePreset ?? null,
    styleImage: style?.imagePaths[0] ?? null,
    protagonists,
    episodeCast,
    scenes,
    recentEpisodes,
  };
}

/** 将合集上下文拼成注入剧本 prompt 的中文段落 */
/** 对主体绑定应用合集规则：画风跟随本集所选画风（未选时取合集第一个），主角角色固定为合集主角资产 */
export async function applySeriesLock(
  bindings: SubjectBindings,
  seriesId: string | null,
  styleAssetId?: string | null,
): Promise<SubjectBindings> {
  if (!seriesId) return bindings;
  const series = await db.series.findUnique({ where: { id: seriesId } });
  if (!series) return bindings;

  const linked = await getSeriesAssetLinks(series.id);
  const protos = linked.protagonistIds
    .map((id) => linked.assetsById.get(id))
    .filter((a): a is AssetRow => !!a && a.type === "character")
    .map((a) => ({ id: a.id, name: a.name }));

  const targetStyleId =
    styleAssetId && linked.styleIds.includes(styleAssetId)
      ? styleAssetId
      : (linked.styleIds[0] ?? null);
  const next: SubjectBindings = {
    ...bindings,
    style: targetStyleId ? { ...bindings.style, assetId: targetStyleId } : bindings.style,
  };
  next.characters = (bindings.characters ?? []).map((c) => {
    const hit = protos.find(
      (p) => p.name === c.name || p.name.includes(c.name) || c.name.includes(p.name),
    );
    return hit ? { ...c, assetId: hit.id } : c;
  });
  return next;
}

export type SeriesSummary = {
  id: string;
  name: string;
  intro: string;
  /** 内容标签（替代旧题材方向/类别） */
  tags: TagInfo[];
  status: string;
  styleAssetId: string | null;
  styles: SeriesStyleInfo[];
  sceneAssetIds: string[];
  memberAssetIds: string[];
  styleName: string | null;
  styleImage: string | null;
  protagonists: SeriesProtagonistInfo[];
  members: Array<{ id: string; name: string; type: string; image: string | null }>;
  coverPath: string | null;
  episodeCount: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

/** 序列化合集（含主角/画风/成员资产快照与集数），供列表与详情接口复用 */
export async function serializeSeries(id: string): Promise<SeriesSummary> {
  const s = await db.series.findUniqueOrThrow({
    where: { id },
    include: { tags: { include: { tag: true } } },
  });
  const [episodeCount, linked] = await Promise.all([
    db.task.count({ where: { seriesId: s.id } }),
    getSeriesAssetLinks(s.id),
  ]);
  const styleAssets = linked.styleIds
    .map((sid) => linked.assetsById.get(sid))
    .filter((a): a is AssetRow => !!a && a.type === "style");
  const style = styleAssets[0] ?? null;
  const toProtoInfo = (ids: string[]) =>
    ids
      .map((pid) => linked.assetsById.get(pid))
      .filter((a): a is AssetRow => !!a && a.type === "character")
      .map((a) => ({
        id: a.id,
        name: a.name,
        imagePrompt: assetAppearance(a),
        keywords: a.keywords,
        image: assetPrimaryImage(a),
        characterProfile: a.characterProfile,
        personality: a.personality,
        traits: a.traits,
      }));
  return {
    id: s.id,
    name: s.name,
    intro: s.intro,
    tags: s.tags.map((x) => ({ id: x.tag.id, name: x.tag.name, description: x.tag.description })),
    status: s.status,
    sortOrder: s.sortOrder,
    styleAssetId: linked.styleIds[0] ?? null,
    styles: styleAssets.map((a) => ({
      id: a.id,
      name: a.name,
      image: a.imagePaths[0] ?? null,
      stylePreset: a.stylePreset,
    })),
    sceneAssetIds: linked.sceneAssetIds,
    memberAssetIds: linked.memberAssetIds,
    styleName: style?.name ?? null,
    styleImage: style?.imagePaths[0] ?? null,
    protagonists: toProtoInfo(linked.protagonistIds),
    members: linked.memberAssetIds
      .map((mid) => linked.assetsById.get(mid))
      .filter((a): a is AssetRow => !!a)
      .map((a) => ({ id: a.id, name: a.name, type: a.type, image: assetPrimaryImage(a) })),
    coverPath: s.coverPath,
    episodeCount,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** 合集剧集列表（按集数升序），供合集详情页展示 */
export async function listSeriesEpisodes(seriesId: string) {
  // 多对多归属：主合集或附加归属命中即出现在该合集的剧集列表
  return db.task.findMany({
    where: { OR: [{ seriesId }, { seriesLinks: { some: { seriesId } } }] },
    orderBy: [{ episodeNo: "asc" }, { createdAt: "asc" }],
    select: {
      taskId: true,
      status: true,
      title: true,
      scriptJson: true,
      episodeNo: true,
      episodeDigest: true,
      imagePathsJson: true,
      draftMediaId: true,
      createdAt: true,
    },
  });
}

/** 合集拖拽排序：order 为新的全局顺序（合集 id 数组）；只更新仍存在的 id，顺序号按 0..n 重写 */
export async function reorderSeries(order: string[]): Promise<void> {
  if (order.length === 0) return;
  const existing = await db.series.findMany({ where: { id: { in: order } }, select: { id: true } });
  const idSet = new Set(existing.map((s) => s.id));
  // 紧凑编号：过滤掉不存在的 id 后按 0..n-1 重新编号，避免陈旧列表留下空洞或撞号
  let index = -1;
  const updates: ReturnType<typeof db.series.update>[] = [];
  for (const id of order) {
    if (!idSet.has(id)) continue;
    index += 1;
    updates.push(db.series.update({ where: { id }, data: { sortOrder: index } }));
  }
  if (updates.length > 0) {
    await db.$transaction(updates);
  }
}

/** 校验资产写入的合集关联：合集存在、角色与类型匹配、画风冲突（返回错误信息或 null） */
export async function validateAssetSeriesLinks(
  assetId: string,
  assetType: string,
  entries: Array<{ seriesId: string; role?: string }>,
): Promise<string | null> {
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.seriesId)) return "同一合集不能重复选择";
    seen.add(e.seriesId);
    const series = await db.series.findUnique({ where: { id: e.seriesId } });
    if (!series) return "合集不存在";
    const role: AssetSeriesRole =
      (e.role as AssetSeriesRole | undefined) ?? inferAssetSeriesRole(assetType);
    if (role === "style" && assetType !== "style") return "仅画风资产可作为合集画风";
    if (role === "protagonist" && assetType !== "character") return "仅角色资产可作为合集主角";
    if (role === "scene" && assetType !== "scene") return "仅场景资产可作为合集常设场景";
  }
  return null;
}
