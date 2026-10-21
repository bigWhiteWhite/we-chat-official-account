"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { TagRow } from "@/lib/api";

/** 触发器上最多平铺的已选标签数，其余折叠为 +N */
const MAX_VISIBLE = 6;

/**
 * 内容标签多选下拉（合集表单 / 新建剧集共用）：搜索命中名称与说明，勾选不关闭面板，
 * 达到 max 上限后未选中的禁用。标签库规模增长后替代平铺胶囊。
 */
export function TagSelect({
  tags,
  selected,
  onToggle,
  max = 12,
  disabled,
  placeholder = "选择内容标签…",
  className,
}: {
  tags: TagRow[];
  selected: string[];
  onToggle: (id: string) => void;
  max?: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const full = selected.length >= max;
  const selectedTags = tags.filter((t) => selected.includes(t.id));
  const shown = selectedTags.slice(0, MAX_VISIBLE);
  const rest = selectedTags.length - shown.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-auto min-h-9 w-full flex-wrap justify-start gap-1.5 py-1.5 text-left font-normal",
            className,
          )}
        >
          {shown.length === 0 ? (
            <span className="text-sm text-slate-400">{placeholder}</span>
          ) : (
            shown.map((t) => (
              <Badge
                key={t.id}
                variant="secondary"
                className="gap-0.5 rounded-full py-0.5 pr-1 text-xs font-normal"
              >
                {t.name}
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`移除标签 ${t.name}`}
                  className="flex size-4 cursor-pointer items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(t.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      e.preventDefault();
                      onToggle(t.id);
                    }
                  }}
                >
                  <X className="size-3" />
                </span>
              </Badge>
            ))
          )}
          {rest > 0 && <span className="text-xs text-slate-400">+{rest}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="搜索标签名称 / 说明…" />
          <CommandList>
            <CommandEmpty>{tags.length === 0 ? "标签库暂无标签" : "无匹配标签"}</CommandEmpty>
            <CommandGroup>
              {tags.map((t) => {
                const on = selected.includes(t.id);
                return (
                  <CommandItem
                    key={t.id}
                    value={t.id}
                    keywords={[t.name, t.description]}
                    disabled={!on && full}
                    data-checked={on}
                    className="cursor-pointer"
                    onSelect={() => onToggle(t.id)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{t.name}</span>
                      {t.description && (
                        <span className="block truncate text-xs text-slate-400">
                          {t.description}
                        </span>
                      )}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-2.5 py-2">
          <span className="text-xs text-slate-400">
            已选 {selected.length} / {max}
          </span>
          {full && <span className="text-xs text-amber-600">已达上限，取消勾选后可替换</span>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
