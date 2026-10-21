"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { api, type TaskScript } from "@/lib/api";
import { buildPanelPrompt } from "@/pipeline/prompts/panel";

export function PanelPromptModal({
  taskId,
  script,
  index,
  stylePreset,
  layout,
  fullPrompt,
  narrationInImage,
  onClose,
  onSaved,
}: {
  taskId: string;
  script: TaskScript;
  index: number;
  stylePreset?: string;
  layout?: "wide" | "tall";
  /** 服务端按真实生图规则组装的完整提示词；缺省时退回本地拼装 */
  fullPrompt?: string | null;
  /** 是否将旁白渲染进画面（对应服务端 NARRATION_IN_IMAGE） */
  narrationInImage?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const panel = script.panels[index];
  const shownPrompt = fullPrompt?.trim()
    ? fullPrompt
    : buildPanelPrompt(
        script,
        panel,
        index,
        stylePreset || "默认",
        layout,
        narrationInImage ?? false,
      );
  const [narration, setNarration] = useState(panel?.narration ?? "");
  const buildNext = () =>
    ({
      ...script,
      panels: script.panels.map((p, i) =>
        i === index
          ? {
              scene: form.store.state.values.scene.trim(),
              character: form.store.state.values.character.trim(),
              dialogue: form.store.state.values.dialogue.trim(),
              narration: narration.trim(),
            }
          : p,
      ),
    }) as TaskScript;
  async function saveOnly() {
    await api.saveScript(taskId, buildNext());
    toast.success(`第 ${index + 1} 格提示词已保存`);
    void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    onClose();
  }
  const form = useForm({
    defaultValues: {
      scene: panel?.scene ?? "",
      character: panel?.character ?? "",
      dialogue: panel?.dialogue ?? "",
    },
    onSubmit: async ({ value }) => {
      await api.saveScript(taskId, buildNext());
      toast.success(`第 ${index + 1} 格提示词已更新`);
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      onClose();
      onSaved();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[80%] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>第 {index + 1} 格提示词</DialogTitle>
          <DialogDescription>
            调整画面/角色/台词后，可重新生成该格以避开安全拦截。
          </DialogDescription>
        </DialogHeader>
        {/* 当前完整提示词展示 */}
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="mb-1 text-xs font-medium text-slate-500">当前完整提示词</p>
          {/* Radix Viewport 的 h-full 不受父级 max-height 钳制，需固定高度才能滚动 */}
          <ScrollArea className="h-64">
            <pre className="whitespace-pre-wrap break-all text-xs leading-relaxed text-slate-700">
              {shownPrompt}
            </pre>
          </ScrollArea>
        </div>
        <div className="grid gap-4 py-2">
          <form.Field name="scene">
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor="panel-scene">画面（不限字数，写足细节）</Label>
                <Textarea
                  id="panel-scene"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  rows={3}
                />
              </div>
            )}
          </form.Field>
          <form.Field name="character">
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor="panel-character">角色（≤50字）</Label>
                <Input
                  id="panel-character"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  maxLength={50}
                />
              </div>
            )}
          </form.Field>
          <form.Field name="dialogue">
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor="panel-dialogue">气泡台词（≤300字）</Label>
                <Input
                  id="panel-dialogue"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  maxLength={300}
                />
              </div>
            )}
          </form.Field>
          <div className="grid gap-2">
            <Label htmlFor="panel-narration">旁白文字（≤200字）</Label>
            <Textarea
              id="panel-narration"
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="没有旁白填「无」"
            />
            <p className="text-xs text-slate-400">
              {narrationInImage
                ? "旁白将渲染进画面（横竖版均生效）；没有旁白填「无」。"
                : "旁白不会渲染进画面，发布时展示在图片下方；没有旁白填「无」。"}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(isSubmitting) => (
              <Button variant="outline" onClick={() => void saveOnly()} disabled={isSubmitting}>
                保存
              </Button>
            )}
          </form.Subscribe>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(isSubmitting) => (
              <Button onClick={() => void form.handleSubmit()} disabled={isSubmitting}>
                {isSubmitting ? "保存中…" : "保存并重新生成"}
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
