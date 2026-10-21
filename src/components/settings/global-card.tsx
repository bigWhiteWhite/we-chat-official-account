"use client";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Save } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

/** 全局兜底卡保存时上报的切片 */
export type GlobalPatch = {
  autoFallback: boolean;
  baseUrl: string;
  apiKey: string;
};

export type GlobalView = {
  autoFallback: boolean;
  baseUrl: string;
  apiKeyMasked: string | null;
  hasApiKey: boolean;
};

export function GlobalCard({
  global,
  onPatch,
}: {
  global: GlobalView;
  onPatch: (patch: GlobalPatch) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  const form = useForm({
    defaultValues: {
      autoFallback: global.autoFallback,
      baseUrl: global.baseUrl,
      apiKey: "",
    },
    onSubmit: async ({ value }) => {
      setSaving(true);
      try {
        await onPatch({
          autoFallback: value.autoFallback,
          baseUrl: value.baseUrl.trim(),
          apiKey: value.apiKey.trim(), // 空串=不修改
        });
        form.setFieldValue("apiKey", ""); // 保存后清空输入框，避免明文 Key 留存 DOM
      } finally {
        setSaving(false);
      }
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">全局兜底</CardTitle>
          <CardDescription className="text-xs">
            各域未单独配置时的回落 Base URL / API Key，及是否自动降级
          </CardDescription>
        </div>
        <Badge variant="secondary">global</Badge>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 md:col-span-2">
            <div>
              <p className="text-sm font-medium text-slate-700">自动降级</p>
              <p className="text-xs text-slate-400">
                失败时在多候选间自动降级；当前每域只有一个主模型，故此开关暂无实际效果
              </p>
            </div>
            <form.Field name="autoFallback">
              {(f) => <Switch checked={f.state.value} onCheckedChange={(v) => f.handleChange(v)} />}
            </form.Field>
          </div>
          <div className="space-y-1.5">
            <Label>全局 Base URL</Label>
            <form.Field name="baseUrl">
              {(f) => (
                <Input
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                  placeholder="https://.../v1（域级未配置时回落）"
                  className="font-mono text-xs"
                />
              )}
            </form.Field>
          </div>
          <div className="space-y-1.5">
            <Label>全局 API Key</Label>
            <form.Field name="apiKey">
              {(f) => (
                <PasswordInput
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                  placeholder={
                    global.hasApiKey
                      ? `已保存 ${global.apiKeyMasked}，留空不修改`
                      : "sk-...（可留空）"
                  }
                  className="font-mono text-xs"
                />
              )}
            </form.Field>
          </div>
        </div>

        <Separator className="my-4" />

        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            className="gap-2 cursor-pointer"
            onClick={() => void form.handleSubmit()}
            disabled={saving}
          >
            <Save /> {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
