"use client";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { Save, KeyRound, User, Palette, Zap } from "lucide-react";

import type { BusinessSettingsSave, BusinessSettingsView } from "@/lib/settings-payload";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

export function BusinessCard({
  business,
  onPatch,
}: {
  business: BusinessSettingsView;
  onPatch: (patch: BusinessSettingsSave) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const form = useForm({
    defaultValues: {
      appid: business.appid,
      appsecret: "",
      author: business.author,
      stylePreset: business.stylePreset,
      narrationInImage: business.narrationInImage,
      imageGenConcurrency: business.imageGenConcurrency,
    },
    onSubmit: async ({ value }) => {
      if (!value.appid.trim()) {
        toast.error("请填写公众号 AppID");
        return;
      }
      const patch: BusinessSettingsSave = {
        appid: value.appid.trim(),
        appsecret: value.appsecret.trim(), // 空串=不修改
        author: value.author.trim(),
        stylePreset: value.stylePreset.trim(),
        narrationInImage: value.narrationInImage,
        imageGenConcurrency: value.imageGenConcurrency,
      };
      setSaving(true);
      try {
        await onPatch(patch);
        form.setFieldValue("appsecret", ""); // 保存后清空输入框，避免明文留存 DOM
      } finally {
        setSaving(false);
      }
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">公众号与内容</CardTitle>
          <CardDescription className="text-xs">
            微信 AppID/AppSecret、作者署名、画风与生成参数
          </CardDescription>
        </div>
        <Badge variant="secondary">业务</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
              <KeyRound className="h-3.5 w-3.5" /> 公众号 AppID
            </Label>
            <form.Field name="appid">
              {(f) => (
                <Input
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                  placeholder="wx...（发布/素材上传必需）"
                  className="font-mono text-xs"
                />
              )}
            </form.Field>
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
              <KeyRound className="h-3.5 w-3.5" /> 公众号 AppSecret
            </Label>
            <form.Field name="appsecret">
              {(f) => (
                <PasswordInput
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                  placeholder={
                    business.hasAppsecret
                      ? `已保存 ${business.appsecretMasked}，留空不修改`
                      : "请输入 AppSecret"
                  }
                  className="font-mono text-xs"
                />
              )}
            </form.Field>
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
              <User className="h-3.5 w-3.5" /> 默认作者
            </Label>
            <form.Field name="author">
              {(f) => (
                <Input
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                  placeholder="草稿箱署名（可留空，回落默认）"
                />
              )}
            </form.Field>
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
              <Palette className="h-3.5 w-3.5" /> 默认画风
            </Label>
            <form.Field name="stylePreset">
              {(f) => (
                <Input
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                  placeholder={business.stylePreset || "简约线条+低饱和色块+扁平卡通"}
                />
              )}
            </form.Field>
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
              <Zap className="h-3.5 w-3.5" /> 生图并发
            </Label>
            <form.Field name="imageGenConcurrency">
              {(f) => (
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.valueAsNumber)}
                  className="w-24"
                />
              )}
            </form.Field>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
          <div>
            <p className="text-sm font-medium text-slate-700">旁白写入画面</p>
            <p className="text-xs text-slate-400">
              开启后分格提示词将保留旁白文案（关闭则只保留画面指令）
            </p>
          </div>
          <form.Field name="narrationInImage">
            {(f) => <Switch checked={f.state.value} onCheckedChange={(v) => f.handleChange(v)} />}
          </form.Field>
        </div>

        <Separator />

        <div className="space-y-1.5 text-xs text-slate-400">
          <p className="font-medium text-slate-500">只读信息</p>
          <p>数据库：{business.dbFile}（运行时绑定，改动需修改 .env 后重启）</p>
          <p>
            预留配置：comicsDir / inboxDir / topicSources / panelsMaxPerChapter / dailyBudgetCny /
            maxImagePerTask（当前版本未接入代码，仅供查看 .env 现状）
          </p>
        </div>

        <Button
          type="button"
          size="sm"
          className="gap-2 cursor-pointer"
          onClick={() => void form.handleSubmit()}
          disabled={saving}
        >
          <Save /> {saving ? "保存中…" : "保存"}
        </Button>
      </CardContent>
    </Card>
  );
}
