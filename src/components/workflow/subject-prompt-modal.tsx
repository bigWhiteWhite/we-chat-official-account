"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { toast } from "sonner";

export type SubjectPromptTarget = {
  kind: "style" | "character";
  index?: number;
  name?: string;
  title: string;
  prompt: string;
};

/** 主体参考图提示词修改弹窗：保存覆盖提示词，后续单主体生成优先使用 */
export function SubjectPromptModal({
  taskId,
  target,
  onClose,
  onRegenerate,
}: {
  taskId: string;
  target: SubjectPromptTarget;
  onClose: () => void;
  onRegenerate: () => Promise<void> | void;
}) {
  const queryClient = useQueryClient();
  const [regenerateAfter, setRegenerateAfter] = useState(false);
  const form = useForm({
    defaultValues: { prompt: target.prompt },
    onSubmit: async ({ value }) => {
      try {
        await api.updateSubjectPrompt(taskId, {
          kind: target.kind,
          name: target.name,
          prompt: value.prompt.trim(),
        });
        toast.success("主体提示词已保存");
        await queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "主体提示词保存失败");
        return;
      }
      if (regenerateAfter) await onRegenerate();
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{target.title}</DialogTitle>
          <DialogDescription>
            调整完整生成提示词后保存；重新生成时将优先使用当前内容。
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="prompt">
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor="subject-prompt">生成提示词</Label>
                <Textarea
                  id="subject-prompt"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  maxLength={2000}
                  rows={10}
                />
              </div>
            )}
          </form.Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(isSubmitting) => (
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => {
                  setRegenerateAfter(false);
                  void form.handleSubmit();
                }}
              >
                保存
              </Button>
            )}
          </form.Subscribe>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(isSubmitting) => (
              <Button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setRegenerateAfter(true);
                  void form.handleSubmit();
                }}
              >
                {isSubmitting ? "保存中…" : "保存并重新生成"}
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
