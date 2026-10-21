import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TaskSearch = {
  q: string;
  status: string;
  from: string;
  to: string;
  id: string;
  seriesId: string;
  tagId: string;
};

export type ModalKind = "wizard" | null;

const EMPTY_SEARCH: TaskSearch = {
  q: "",
  status: "",
  from: "",
  to: "",
  id: "",
  seriesId: "",
  tagId: "",
};

type UiState = {
  /** 列表搜索条件（空串=不限） */
  search: TaskSearch;
  setSearch: (patch: Partial<TaskSearch>) => void;
  resetSearch: () => void;
  /** 弹窗状态：向导式新建生产 */
  modal: ModalKind;
  setModal: (modal: ModalKind) => void;
  /** 任务详情弹窗当前查看的任务 id（null=关闭） */
  detailTaskId: string | null;
  openDetail: (taskId: string) => void;
  closeDetail: () => void;
  /** 工作流当前打开的任务 id（null=新建生产）；用于刷新后按任务续接 */
  wizardTaskId: string | null;
  /** 新建生产时预选的合集 id（从合集详情页「创建新一集」进入） */
  wizardSeriesId: string | null;
  /** 打开工作流；taskId 表示续接已有任务，seriesId 表示新建时预选合集 */
  openWizard: (taskId?: string, seriesId?: string) => void;
  /** 全局漫画布局（横版 wide / 竖版 tall），localStorage 持久化 */
  comicLayout: "wide" | "tall";
  setComicLayout: (layout: "wide" | "tall") => void;
  /** 参考图生成比例 */
  genSize: string;
  setGenSize: (size: string) => void;
  closeWizard: () => void;
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      search: EMPTY_SEARCH,
      setSearch: (patch) => set((s) => ({ search: { ...s.search, ...patch } })),
      resetSearch: () => set({ search: EMPTY_SEARCH }),
      modal: null,
      setModal: (modal) => set({ modal }),
      detailTaskId: null,
      openDetail: (taskId) => set({ detailTaskId: taskId }),
      closeDetail: () => set({ detailTaskId: null }),
      wizardTaskId: null,
      wizardSeriesId: null,
      openWizard: (taskId, seriesId) =>
        set({
          modal: "wizard",
          wizardTaskId: taskId ?? null,
          wizardSeriesId: seriesId ?? null,
          detailTaskId: null,
        }),
      comicLayout: "tall",
      setComicLayout: (layout) => {
        set({ comicLayout: layout });
      },
      genSize: "1024x1024",
      setGenSize: (size) => set({ genSize: size }),
      closeWizard: () => set({ modal: null, wizardTaskId: null, wizardSeriesId: null }),
    }),
    {
      name: "ui-store",
      partialize: (state) => ({
        comicLayout: state.comicLayout,
        genSize: state.genSize,
      }),
    },
  ),
);
