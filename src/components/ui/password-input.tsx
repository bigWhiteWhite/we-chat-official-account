"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PasswordInputProps = React.ComponentProps<typeof Input>;

/** 带显示/隐藏切换的密码输入框（shadcn 无现成组件，由 Input + 图标按钮组合实现） */
export function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cn("pr-9", className)} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={visible ? "隐藏密码" : "显示密码"}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 h-full w-9 rounded-l-none text-muted-foreground hover:text-foreground"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </Button>
    </div>
  );
}
