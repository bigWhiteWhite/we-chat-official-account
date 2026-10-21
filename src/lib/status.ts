export type StatusMeta = { label: string; className: string; spinner?: boolean };

export const STATUS_META: Record<string, StatusMeta> = {
  collecting: { label: "选题中", className: "bg-slate-200 text-slate-600", spinner: true },
  writing: { label: "剧本生成中", className: "bg-blue-100 text-blue-700", spinner: true },
  script_ready: { label: "剧本待确认", className: "bg-indigo-100 text-indigo-700" },
  subjects_ready: { label: "主体已确认", className: "bg-cyan-100 text-cyan-700" },
  drawing: { label: "生图中", className: "bg-blue-100 text-blue-700", spinner: true },
  reviewing: { label: "待审核", className: "bg-green-100 text-green-700" },
  review_passed: { label: "审核通过", className: "bg-emerald-100 text-emerald-700" },
  publishing: { label: "发布中", className: "bg-amber-100 text-amber-700", spinner: true },
  done: { label: "已建草稿", className: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "已弃稿", className: "bg-slate-200 text-slate-500" },
  failed: { label: "失败", className: "bg-red-100 text-red-700" },
  stopped: { label: "已停止", className: "bg-orange-100 text-orange-700" },
};

export function statusMeta(status: string): StatusMeta {
  return STATUS_META[status] ?? { label: status, className: "bg-slate-100 text-slate-600" };
}

export const SOURCE_LABELS: Record<string, string> = {
  "self-made": "LLM 自创",
  "user-outline": "自定义大纲",
  "user-script": "用户剧本",
};
