import type { AssetType } from "@/lib/api";

/** 变体仅存在于角色 / 场景两类资产 */
export type VariantKind = Exclude<AssetType, "style">;

/** 按资产类型区分的变体文案（列头 / 区块标题 / 主形象 / 外观设定弹窗） */
export const VARIANT_LABELS: Record<
  VariantKind,
  {
    /** 名称列头与输入占位 */
    name: string;
    /** 外观/设定列头与输入占位 */
    setting: string;
    /** 区块标题 */
    section: string;
    /** 主形象/主场景 */
    primary: string;
    /** 名词（用于 toast / 删除弹窗） */
    unit: string;
    /** 外观/设定弹窗说明 */
    appearanceHint: string;
    /** 外观/设定弹窗占位 */
    appearancePlaceholder: string;
  }
> = {
  character: {
    name: "形象名",
    setting: "外观设定",
    section: "形象变体",
    primary: "主形象",
    unit: "形象",
    appearanceHint: "描述外观特征，如服饰、发型、配色、道具等",
    appearancePlaceholder: "如：青衫白发，背负长剑，眉目冷淡",
  },
  scene: {
    name: "场景名",
    setting: "场景设定",
    section: "场景变体",
    primary: "主场景",
    unit: "场景",
    appearanceHint: "描述场景特征，如布局、光线、氛围、道具等",
    appearancePlaceholder: "如：山门石阶，云雾缭绕，两侧宫灯，远处有飞瀑",
  },
};
