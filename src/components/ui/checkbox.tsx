"use client";

import * as React from "react";
import { CheckIcon, Minus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group/box grid size-6 shrink-0 select-none place-content-center rounded border border-slate-300 bg-white shadow-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-slate-900 data-[state=checked]:bg-slate-900 data-[state=indeterminate]:border-slate-900 data-[state=indeterminate]:bg-slate-900 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:text-white [&_svg]:opacity-0 data-[state=checked]:[&_svg]:opacity-100 data-[state=indeterminate]:[&_svg]:opacity-100",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center leading-none"
      >
        {/* Radix Indicator 无函数 children 类型，三态图标用变体切换 */}
        <CheckIcon className="size-3.5 group-data-[state=indeterminate]/box:hidden" />
        <Minus className="hidden size-3.5 group-data-[state=indeterminate]/box:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
