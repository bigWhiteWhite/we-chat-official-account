"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ImageAction = {
  key: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "secondary" | "destructive" | "outline";
};

/** 图片悬停操作组：分格格口（横排）与主体卡（竖排）共用，随容器 group 悬停显示 */
export function ImageActionOverlay({
  actions,
  direction = "column",
  className,
}: {
  actions: ImageAction[];
  direction?: "row" | "column";
  className?: string;
}) {
  if (actions.length === 0) return null;
  return (
    <div
      className={cn(
        "absolute inset-x-0 top-0 z-20 flex bg-gradient-to-b from-black/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100",
        direction === "row" ? "flex-wrap justify-between gap-1 p-2" : "flex-col gap-1 p-1.5",
        className,
      )}
    >
      {actions.map((action) => (
        <Button
          key={action.key}
          size="sm"
          variant={action.variant ?? "secondary"}
          className={direction === "row" ? "h-7 text-xs" : "h-7 w-full text-xs"}
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}
