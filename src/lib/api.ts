// type-only import：不引入服务端运行时依赖
import type { AppSettingsPayload, AppSettingsSavePayload } from "@/lib/settings-payload";

export type TaskSearch = {
  q?: string;
  status?: string;
  from?: string;
  to?: string;
  id?: string;
  seriesId?: string;
  tagId?: string;
};

/** 内容标签轻量引用（列表页） */
export type TagRef = { id: string; name: string };
/** 内容标签完整信息：description 即 LLM 行为说明书 */
export type TagInfo = TagRef & { description: string };
/** 标签库行（含使用数） */
export type TagRow = TagInfo & {
  taskCount: number;
  seriesCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TaskSummary = {
  taskId: string;
  status: string;
  title: string;
  sourceType: string;
  tags: TagRef[];
  imageCnt: number;
  draftMediaId: string | null;
  error: string | null;
  createdAt: string;
  seriesName: string | null;
  /** 合集归属（多选）；首项为主合集 */
  seriesLinks: Array<{ seriesId: string; seriesName: string }>;
  episodeNo: number | null;
};

export type SeriesProtagonistInfo = {
  id: string;
  name: string;
  imagePrompt: string;
  keywords: string;
  image: string | null;
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

export type SeriesContextInfo = {
  id: string;
  name: string;
  intro: string;
  /** 合集中全部画风（有序，第一个为默认） */
  styles: SeriesStyleInfo[];
  /** 本集选中的画风（task.styleAssetId 未设置时回落到第一个） */
  styleAssetId: string;
  styleName: string | null;
  styleImage: string | null;
  protagonists: SeriesProtagonistInfo[];
  /** 本集出场角色（创建任务时所选；空=全部主角） */
  episodeCast?: SeriesProtagonistInfo[];
  scenes: Array<{ id: string; name: string }>;
  recentEpisodes: SeriesRecentEpisode[];
};

export type SeriesSummary = {
  id: string;
  name: string;
  intro: string;
  /** 内容标签（新建剧集时默认带入） */
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

export type SeriesEpisode = {
  taskId: string;
  episodeNo: number | null;
  title: string;
  status: string;
  digest: string;
  cover: string | null;
  hasDraft: boolean;
  createdAt: string;
};

export type ComicPanelRow = {
  scene: string;
  character: string;
  dialogue: string;
  narration?: string;
};

export type TaskScript = {
  title: string;
  source?: string;
  source_url?: string;
  theme?: string;
  intro?: string;
  target_panels?: number;
  panels: ComicPanelRow[];
  punchline?: string;
  risk_tags?: string[];
};

/** 与 scriptJson.panels 按下标对齐，失败格为 null */
export type AssetType = "character" | "scene" | "style";

export type AssetSummary = {
  id: string;
  type: AssetType;
  name: string;
  keywords: string;
  characterProfile: string;
  personality: string;
  traits: string;
  imagePaths: string[];
  /** 形象变体（角色/场景的多个形象，首项为主形象） */
  variants: Array<{
    id: string;
    name: string;
    styleId: string;
    styleName: string;
    appearance: string;
    image: string;
  }>;
  /** 主参考图：角色/场景取主形象，画风取样图 */
  primaryImage: string | null;
  stylePreset: string | null;
  sourceTaskId: string | null;
  usageCount: number;
  sortOrder: number;
  createdAt: string;
  seriesLinks: Array<{ seriesId: string; seriesName: string; role: string }>;
};

export type SubjectBindings = {
  style?: { assetId: string | null; preset?: string };
  scene: { name: string; assetId: string | null; variantId?: string | null };
  characters: Array<{ name: string; assetId: string | null; variantId?: string | null }>;
};

export type TaskReferences = {
  style?: { assetId: string | null; preset: string; image: string | null };
  scene: { assetId: string | null; name: string; image: string | null };
  characters: Array<{
    name: string;
    assetId: string | null;
    image: string | null;
    /** 确认主体时 LLM 补全的外观设定（未绑定角色） */
    appearance?: string | null;
  }>;
};

export function isTaskReferences(refs: TaskDetail["references"]): refs is TaskReferences {
  return !!refs && Array.isArray((refs as TaskReferences).characters);
}

export type TaskDetail = {
  taskId: string;
  status: string;
  generating: boolean;
  /** 服务端在途的单格重生成下标（与 panels 对齐），刷新后格子仍可显示生成中 */
  generatingPanels?: number[];
  stylePreset?: string;
  narrationInImage?: boolean;
  layout?: string;
  sourceType: string;
  tags?: TagInfo[];
  title: string;
  script: TaskScript | null;
  /** 与 panels 下标对齐的逐格生图提示词（服务端按真实生图规则组装，供预览） */
  panelPrompts?: string[];
  /** 各主体参考图的完整生成提示词（绑定资产的主体为 null），characters 与主体列表按下标对齐 */
  subjectPrompts?: { style: string | null; scene: string | null; characters: Array<string | null> };
  subjectPromptOverrides?: {
    style?: string;
    scene?: string;
    characters?: Record<string, string>;
  };
  images: (string | null)[];
  references: TaskReferences | Record<string, string> | null;
  subjectBindings: SubjectBindings | null;
  reviewResult: string | null;
  reviewNote: string | null;
  error: string | null;
  draftMediaId: string | null;
  publish: { draftMediaId: string; title: string } | null;
  createdAt: string;
  seriesId: string | null;
  styleAssetId: string | null;
  episodeNo: number | null;
  episodeDigest: string | null;
  carryContext: boolean;
  series: SeriesContextInfo | null;
};

export type StageEventRow = {
  id: number;
  stage: string;
  eventType: string;
  message: string;
  payloadJson: string | null;
  createdAt: string;
};

export type WeixinFeedback = { errcode: number; errmsg: string };

export type PublishResult = {
  draftMediaId: string;
  feedback: WeixinFeedback;
  title: string;
};

export type ApiError = Error & { feedback?: WeixinFeedback };

/** 某格在磁盘上的一个图片版本（version 0 = 旧格式无后缀初始版本） */
export type PanelVersionInfo = {
  version: number;
  fileName: string;
  path: string;
  updatedAt: string;
  isActive: boolean;
};

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) {
    const text = await res.text();
    let message = text || `请求失败（${res.status}）`;
    let feedback: WeixinFeedback | undefined;
    try {
      const data = JSON.parse(text) as { error?: string; feedback?: WeixinFeedback };
      if (data && typeof data === "object") {
        if (typeof data.error === "string" && data.error) message = data.error;
        if (data.feedback) feedback = data.feedback;
      }
    } catch {
      // 非 JSON 错误体，保留原始文本
    }
    const err = new Error(message) as ApiError;
    if (feedback) err.feedback = feedback;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const api = {
  getTasks: (params: TaskSearch = {}) => {
    const sp = new URLSearchParams();
    if (params.q) sp.set("q", params.q);
    if (params.status) sp.set("status", params.status);
    if (params.from) sp.set("from", params.from);
    if (params.to) sp.set("to", params.to);
    if (params.id) sp.set("id", params.id);
    if (params.seriesId) sp.set("seriesId", params.seriesId);
    if (params.tagId) sp.set("tagId", params.tagId);
    const qs = sp.toString();
    return j<{ tasks: TaskSummary[] }>(`/api/tasks${qs ? `?${qs}` : ""}`);
  },
  createTask: (
    sourceType: string,
    outline?: string,
    tagIds?: string[],
    seriesId?: string,
    carryContext?: boolean,
    episodeCharacterIds?: string[],
    styleAssetId?: string,
  ) =>
    j<{ taskId: string; status: string }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        sourceType,
        outline: outline || undefined,
        tagIds: tagIds && tagIds.length > 0 ? tagIds : undefined,
        seriesId: seriesId || undefined,
        carryContext: carryContext || undefined,
        styleAssetId: styleAssetId || undefined,
        episodeCharacterIds:
          episodeCharacterIds && episodeCharacterIds.length > 0 ? episodeCharacterIds : undefined,
      }),
    }),
  getTask: (taskId: string, layout?: "wide" | "tall") =>
    j<TaskDetail>(`/api/tasks/${taskId}${layout ? `?layout=${layout}` : ""}`),
  /** 保存单个主体参考图提示词覆盖 */
  updateSubjectPrompt: (
    taskId: string,
    input: { kind: "style" | "scene" | "character"; name?: string; prompt: string },
  ) =>
    j<{ ok: boolean }>(`/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ subjectPrompt: input }),
    }),
  /** 写回本集画风（主体确认页切换合集画风时调用） */
  updateTaskStyle: (taskId: string, styleAssetId: string | null) =>
    j<{ ok: boolean }>(`/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ styleAssetId }),
    }),
  stopTask: (taskId: string) =>
    j<{ ok: boolean; aborted: boolean }>(`/api/tasks/${taskId}/stop`, { method: "POST" }),
  getEvents: (taskId: string) => j<{ events: StageEventRow[] }>(`/api/tasks/${taskId}/events`),
  review: (taskId: string, action: "pass" | "regenerate" | "reject", note?: string) =>
    j<{ ok: boolean }>(`/api/tasks/${taskId}/review`, {
      method: "POST",
      body: JSON.stringify({ action, note }),
    }),
  saveScript: (taskId: string, script: unknown) =>
    j<{ ok: boolean }>(`/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ script }),
    }),
  deleteTask: (taskId: string) => j<{ ok: boolean }>(`/api/tasks/${taskId}`, { method: "DELETE" }),
  bulkDeleteTasks: (taskIds: string[]) =>
    j<{ deleted: string[]; skipped: string[] }>("/api/tasks", {
      method: "DELETE",
      body: JSON.stringify({ taskIds }),
    }),
  copyTask: (taskId: string) =>
    j<{ taskId: string; status: string }>(`/api/tasks/${taskId}/copy`, { method: "POST" }),
  regeneratePanel: (taskId: string, index: number, layout?: "wide" | "tall") =>
    j<{ path: string; status: string }>(`/api/tasks/${taskId}/images/${index}/regenerate`, {
      method: "POST",
      body: JSON.stringify({ layout }),
    }),
  /** 列出某格磁盘上的全部版本（含初始版本），当前选中版本标记 isActive */
  getPanelVersions: (taskId: string, index: number) =>
    j<{ versions: PanelVersionInfo[] }>(`/api/tasks/${taskId}/images/${index}/versions`),
  /** 切换某格当前版本：仅移动 DB 指针，磁盘全部版本保留 */
  selectPanelVersion: (taskId: string, index: number, versionPath: string) =>
    j<{ ok: boolean; path: string; status: string }>(
      `/api/tasks/${taskId}/images/${index}/versions`,
      {
        method: "POST",
        body: JSON.stringify({ path: versionPath }),
      },
    ),
  deletePanel: (taskId: string, index: number) =>
    j<{ ok: boolean }>(`/api/tasks/${taskId}/panels/${index}`, { method: "DELETE" }),
  reorderPanels: (taskId: string, from: number, to: number) =>
    j<{ ok: boolean }>(`/api/tasks/${taskId}/panels/reorder`, {
      method: "POST",
      body: JSON.stringify({ from, to }),
    }),
  publish: (taskId: string) => j<PublishResult>(`/api/tasks/${taskId}/publish`, { method: "POST" }),
  /** 更新任务合集归属（多选全量替换；原主合集被取消时服务端自动顺延） */
  updateTaskSeries: (taskId: string, seriesIds: string[]) =>
    j<{ ok: boolean }>(`/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ seriesIds }),
    }),
  /** 更新任务内容标签（多选全量替换） */
  updateTaskTags: (taskId: string, tagIds: string[]) =>
    j<{ ok: boolean }>(`/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ tagIds }),
    }),
  getTags: () => j<{ tags: TagRow[] }>("/api/tags"),
  createTag: (body: { name: string; description?: string }) =>
    j<{ tag: { id: string; name: string; description: string } }>("/api/tags", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateTag: (id: string, body: { name?: string; description?: string }) =>
    j<{ tag: { id: string; name: string; description: string } }>(`/api/tags/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteTag: (id: string) => j<{ ok: boolean }>(`/api/tags/${id}`, { method: "DELETE" }),
  deleteTags: (ids: string[]) =>
    j<{ deleted: number }>("/api/tags", { method: "DELETE", body: JSON.stringify({ ids }) }),
  /** 手动刷新微信 access_token（40164 出口 IP 变化加入白名单后使用） */
  refreshWeixinToken: () => j<{ ok: boolean }>("/api/weixin/token/refresh", { method: "POST" }),
  getAssets: (params: { type?: AssetType; q?: string; seriesId?: string } = {}) => {
    const sp = new URLSearchParams();
    if (params.type) sp.set("type", params.type);
    if (params.q) sp.set("q", params.q);
    if (params.seriesId) sp.set("seriesId", params.seriesId);
    const qs = sp.toString();
    return j<{ assets: AssetSummary[] }>(`/api/assets${qs ? `?${qs}` : ""}`);
  },
  getAsset: (id: string) => j<{ asset: AssetSummary }>(`/api/assets/${id}`),
  reorderAssets: (order: string[]) =>
    j<{ ok: boolean }>(`/api/assets/reorder`, { method: "POST", body: JSON.stringify({ order }) }),
  createAsset: (body: {
    type: AssetType;
    name: string;
    keywords?: string;
    characterProfile?: string;
    personality?: string;
    traits?: string;
    stylePreset?: string;
    sourceTaskId?: string;
    imagePaths?: string[];
    imageBase64?: string;
    mimeType?: string;
    /** 角色/场景的首个（主）形象变体 */
    firstVariant?: {
      name?: string;
      styleId?: string;
      styleName?: string;
      appearance?: string;
      imageBase64?: string;
      imagePath?: string;
      mimeType?: string;
    };
    /** 所属合集（全量替换；role 缺省按资产类型推断） */
    seriesLinks?: Array<{ seriesId: string; role?: string }>;
  }) => j<{ asset: AssetSummary }>("/api/assets", { method: "POST", body: JSON.stringify(body) }),
  updateAsset: (
    id: string,
    body: Partial<
      Pick<
        AssetSummary,
        "name" | "keywords" | "stylePreset" | "characterProfile" | "personality" | "traits"
      >
    > & {
      imageBase64?: string;
      mimeType?: string;
      removeImage?: boolean;
      /** 所属合集（全量替换；role 缺省按资产类型推断） */
      seriesLinks?: Array<{ seriesId: string; role?: string }>;
    },
  ) =>
    j<{ asset: AssetSummary }>(`/api/assets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteAsset: (id: string) => j<{ ok: boolean }>(`/api/assets/${id}`, { method: "DELETE" }),
  /** 为角色/场景资产新增形象变体（文生图 = 画风 + 外观设定；传 imageBase64 则直接落图） */
  addAssetVariant: (
    id: string,
    body: {
      name?: string;
      styleId?: string;
      styleName?: string;
      appearance?: string;
      imageBase64?: string;
      mimeType?: "image/png" | "image/jpeg";
    },
  ) =>
    j<{ asset: AssetSummary }>(`/api/assets/${id}/variants`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** 修改形象变体（默认改画风/外观设定 = 重新生成参考图；regenerate: false 仅保存文本；传 imageBase64 则替换参考图） */
  updateAssetVariant: (
    id: string,
    variantId: string,
    body: {
      name?: string;
      styleId?: string | null;
      styleName?: string;
      appearance?: string;
      imageBase64?: string;
      mimeType?: "image/png" | "image/jpeg";
      setPrimary?: boolean;
      regenerate?: boolean;
    },
  ) =>
    j<{ asset: AssetSummary }>(`/api/assets/${id}/variants/${variantId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteAssetVariant: (id: string, variantId: string) =>
    j<{ asset: AssetSummary }>(`/api/assets/${id}/variants/${variantId}`, { method: "DELETE" }),
  generateAssetPreview: (body: {
    type: AssetType;
    name: string;
    imagePrompt?: string;
    stylePreset?: string;
    size?: string;
  }) =>
    j<{ imageBase64: string; mimeType: string }>("/api/assets/generate-preview", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  matchSubjects: (taskId: string) =>
    j<{ bindings: SubjectBindings }>(`/api/tasks/${taskId}/match-subjects`, {
      method: "POST",
      body: "{}",
    }),
  getSeries: () => j<{ series: SeriesSummary[] }>("/api/series"),
  reorderSeries: (order: string[]) =>
    j<{ ok: boolean }>(`/api/series/reorder`, { method: "POST", body: JSON.stringify({ order }) }),
  getSeriesDetail: (id: string) =>
    j<{ series: SeriesSummary; episodes: SeriesEpisode[] }>(`/api/series/${id}`),
  createSeries: (body: {
    name: string;
    intro?: string;
    styleAssetIds: string[];
    protagonistIds: string[];
    sceneAssetIds?: string[];
    memberAssetIds?: string[];
    tagIds?: string[];
  }) => j<{ series: SeriesSummary }>("/api/series", { method: "POST", body: JSON.stringify(body) }),
  updateSeries: (
    id: string,
    body: {
      name?: string;
      intro?: string;
      status?: string;
      coverPath?: string | null;
      tagIds?: string[];
      styleAssetIds?: string[];
      protagonistIds?: string[];
      sceneAssetIds?: string[];
      memberAssetIds?: string[];
    },
  ) =>
    j<{ series: SeriesSummary }>(`/api/series/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteSeries: (id: string) => j<{ ok: boolean }>(`/api/series/${id}`, { method: "DELETE" }),
  updateEpisodeDigest: (taskId: string, digest: string) =>
    j<{ ok: boolean }>(`/api/tasks/${taskId}/episode-digest`, {
      method: "PATCH",
      body: JSON.stringify({ digest }),
    }),
  getAppSettings: () => j<AppSettingsPayload>("/api/settings"),
  saveAppSettings: (payload: AppSettingsSavePayload) =>
    j<AppSettingsPayload>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ payload }),
    }),
  testModelConnection: (body: {
    biz: "main" | "mainLight" | "vision" | "imageApi";
    modelId: string;
    baseUrl: string;
    apiKey?: string;
    apiType?: "chat" | "responses";
  }) =>
    j<{ ok: boolean; latencyMs: number; stage: string; error?: string }>(
      "/api/settings/models/test",
      { method: "POST", body: JSON.stringify(body) },
    ),
  listModels: (body: {
    baseUrl: string;
    apiKey?: string;
    biz?: "main" | "mainLight" | "vision" | "imageApi";
  }) =>
    j<{ models: string[]; error?: string }>("/api/settings/models/list", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

/**
 * 图片统一经 /api/images 白名单路由访问（兼容 data/images 前缀）。
 * URL 版本随全局序列递增：轮询重渲染期间同路径 URL 稳定（不重复请求），
 * 内容被覆盖写入后调 bustImageCache 递增版本强制浏览器重新拉取。
 */
let versionCounter = 0;
let globalVersion = 0;
const imageVersions = new Map<string, number>();

export function imageSrc(p: string): string {
  if (p.startsWith("data:")) return p;
  const v = imageVersions.get(p) ?? globalVersion;
  return `/api/images?path=${encodeURIComponent(p)}&v=${v}`;
}

/** 使图片缓存失效：传 path 只递增该文件版本，不传清空全部并推进全局兜底版本 */
export function bustImageCache(path?: string) {
  if (path) {
    imageVersions.set(path, ++versionCounter);
  } else {
    globalVersion = ++versionCounter;
    imageVersions.clear();
  }
}

export function formatTime(value: string | number | Date): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
