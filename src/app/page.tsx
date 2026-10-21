"use client";

import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/search-bar";
import { TaskList } from "@/components/task-list";
import { useUiStore } from "@/store/ui";

export default function HomePage() {
  const openWizard = useUiStore((s) => s.openWizard);

  return (
    <div className="mx-auto">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">微信公众号 AI 漫画生产控制台</h1>
          <p className="mt-1 text-sm text-slate-500">
            搜索列表 · 交互式工作流：通道选择 → 剧本创作 → 主体确认 → 漫画生成 → 人工审核 → 发布
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button onClick={() => openWizard()} className="px-4 py-2">
            新建生产
          </Button>
        </div>
      </header>
      <div className="space-y-4">
        <SearchBar />
        <TaskList />
      </div>
    </div>
  );
}
