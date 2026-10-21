"use client";

import { useCallback } from "react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { toast } from "sonner";

let nextFeedIdValue = 0;

/** 向导 AI 视图的一条渲染项 */
export type FeedItem =
  | { id: number; type: "model"; model: string }
  | { id: number; type: "stage"; message: string }
  | { id: number; type: "text"; text: string; live: boolean }
  | { id: number; type: "thinking"; text: string; live: boolean }
  | { id: number; type: "tool"; name: string; args?: unknown }
  | { id: number; type: "user"; message: string }
  | { id: number; type: "fallback"; from: string; to: string }
  | { id: number; type: "error"; message: string }
  | { id: number; type: "done"; label: string };

export function nextFeedId(): number {
  nextFeedIdValue = Math.max(nextFeedIdValue + 1, Date.now() * 1000);
  return nextFeedIdValue;
}

function ThinkingBlock({ item }: { item: { id: number; text: string; live: boolean } }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 text-xs">
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer select-none items-center gap-1.5 px-3 py-2 font-medium text-slate-500 hover:bg-slate-100"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        思考过程
        {item.live && <span className="ml-1.5 animate-pulse text-indigo-500">…</span>}
      </Button>
      {open && (
        <div className="max-h-40 overflow-y-auto whitespace-pre-wrap px-3 pb-2 text-slate-500">
          {item.text}
        </div>
      )}
    </div>
  );
}

function ToolLine({ name, args }: { name: string; args?: unknown }) {
  let argText = "";
  try {
    argText = args === undefined || args === null ? "" : JSON.stringify(args);
  } catch {
    argText = String(args);
  }
  if (argText.length > 120) argText = argText.slice(0, 120) + "…";
  return (
    <div className="flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
      <span className="mt-0.5 shrink-0 rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
        工具
      </span>
      <span className="min-w-0 break-all">
        {name}
        {argText && <span className="font-mono"> {argText}</span>}
      </span>
    </div>
  );
}

/**
 * AI 过程流视图：模型徽标 / 阶段节点 / 思考与文本流（自动滚底）/ 工具调用 / 用户消息 / 降级 / 错误。
 */
export function AiFeed({ items }: { items: FeedItem[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const copyAll = useCallback(() => {
    const lines = items
      .filter((i) => i.type === "thinking" || i.type === "text")
      .map((i) => (i as { text: string }).text)
      .filter(Boolean);
    if (lines.length === 0) {
      toast.info("暂无内容可复制");
      return;
    }
    navigator.clipboard.writeText(lines.join("\n\n")).then(
      () => toast.success("已复制全部思考过程"),
      () => toast.error("复制失败"),
    );
  }, [items]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  return (
    <div
      ref={scrollRef}
      className="group relative h-full max-h-[420px] min-h-[240px] space-y-2 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/60 p-3"
    >
      {items.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-400">等待 AI 输出…</p>
      )}
      {items.map((item) => {
        switch (item.type) {
          case "model":
            return (
              <div key={item.id} className="flex items-center gap-2">
                <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                  模型 {item.model}
                </span>
              </div>
            );
          case "stage":
            return (
              <div key={item.id} className="flex items-center gap-2 text-xs text-slate-500">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                {item.message}
              </div>
            );
          case "text":
            return (
              <div
                key={item.id}
                className="whitespace-pre-wrap break-words rounded-md bg-white px-3 py-2 text-sm leading-6 text-slate-700"
              >
                {item.text}
                {item.live && (
                  <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-indigo-400 align-middle" />
                )}
              </div>
            );
          case "thinking":
            return <ThinkingBlock key={item.id} item={item} />;
          case "tool":
            return <ToolLine key={item.id} name={item.name} args={item.args} />;
          case "user":
            return (
              <div
                key={item.id}
                className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900"
              >
                {item.message}
              </div>
            );
          case "fallback":
            return (
              <div key={item.id} className="text-xs text-amber-600">
                模型降级：{item.from} → {item.to}
              </div>
            );
          case "error":
            return (
              <div
                key={item.id}
                className="whitespace-pre-wrap break-words rounded-md bg-red-50 px-3 py-2 text-sm text-red-600"
              >
                {item.message}
              </div>
            );
          case "done":
            return (
              <div
                key={item.id}
                className="flex items-center gap-2 text-xs font-medium text-emerald-600"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                {item.label}
              </div>
            );
        }
      })}
      {items.length > 0 && (
        <button
          type="button"
          onClick={copyAll}
          className="absolute right-2 top-2 z-10 cursor-pointer rounded-md p-1.5 text-slate-400 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-600 group-hover:opacity-100"
          title="复制全部思考过程"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
