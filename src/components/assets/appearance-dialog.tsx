"use client";

import { useEffect } from "react";
import { useForm } from "@tanstack/react-form";

import { preventLightboxInteract } from "@/components/photo-viewer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/** 外观/设定编辑弹窗：长文本 Textarea 编辑（500 字上限）；保存只改文本，不重画参考图 */
export function AppearanceDialog({
  title,
  description,
  initial,
  placeholder,
  onClose,
  onSave,
}: {
  title: string;
  description: string;
  initial: string;
  placeholder: string;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  const form = useForm({
    defaultValues: { value: initial },
    onSubmit: ({ value }) => onSave(value.value),
  });

  // 复用挂载时 initial 变化（切换编辑目标）需要同步重置表单
  useEffect(() => {
    form.reset({ value: initial });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-lg"
        onPointerDownOutside={preventLightboxInteract}
        onInteractOutside={preventLightboxInteract}
        onEscapeKeyDown={preventLightboxInteract}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form.Field name="value">
          {(field) => (
            <>
              <Textarea
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value.slice(0, 500))}
                placeholder={placeholder}
                rows={6}
                className="resize-none text-sm"
              />
              <p className="-mt-1 text-right text-xs text-slate-400">
                {field.state.value.length}/500
              </p>
            </>
          )}
        </form.Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void form.handleSubmit()}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
