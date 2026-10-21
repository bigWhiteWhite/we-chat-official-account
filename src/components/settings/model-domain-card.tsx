"use client";
import { useMemo, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { PlugZap, RefreshCw, Save, CheckCircle2, XCircle } from "lucide-react";

import { api } from "@/lib/api";
import type { ModelSettingDomain } from "@/lib/settings-payload";
import {
  PROVIDER_PRESETS,
  API_TYPE_OPTIONS,
  IMAGE_PROTOCOL_OPTIONS,
  inferProviderId,
  type ApiType,
  type ImageProtocol,
} from "@/lib/provider-presets";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type Biz = "main" | "mainLight" | "vision" | "imageApi";

/** 域卡保存时上报的切片 */
export type DomainPatch = {
  apiType: ApiType;
  imageProtocol: ImageProtocol;
  primary: string;
  baseUrl: string;
  apiKey: string;
};

export function ModelDomainCard({
  biz,
  label,
  domain,
  onPatch,
}: {
  biz: Biz;
  label: { title: string; desc: string };
  domain: ModelSettingDomain;
  onPatch: (biz: Biz, patch: DomainPatch) => Promise<void>;
}) {
  // 供应商：UI 局部态（预设下拉），不落库；刷新后由 Base URL 反推
  const providerOpts = useMemo(() => PROVIDER_PRESETS, []);

  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs: number;
    error?: string;
  } | null>(null);
  const [modelList, setModelList] = useState<string[]>([]);

  const form = useForm({
    defaultValues: {
      provider: inferProviderId(domain.baseUrl),
      apiType: domain.apiType,
      imageProtocol: domain.imageProtocol,
      baseUrl: domain.baseUrl,
      apiKey: "",
      primary: domain.primary,
    },
    onSubmit: async ({ value }) => {
      const rawModel = value.primary.trim();
      if (!rawModel) {
        toast.error("请填写主模型");
        return;
      }
      if (!value.baseUrl.trim()) {
        toast.error("请填写 Base URL");
        return;
      }
      setSaving(true);
      try {
        await onPatch(biz, {
          apiType: value.apiType,
          imageProtocol: value.imageProtocol,
          primary: rawModel,
          baseUrl: value.baseUrl.trim(),
          apiKey: value.apiKey.trim(), // 空串=不修改
        });
        form.setFieldValue("apiKey", ""); // 保存后清空输入框，避免明文 Key 留存 DOM
      } finally {
        setSaving(false);
      }
    },
  });

  // 选择预设供应商时，自动填充 Base URL 与已知模型（仅填充，不落库）
  const pickProvider = (id: string) => {
    form.setFieldValue("provider", id);
    setTestResult(null);
    if (id !== "custom") {
      const p = PROVIDER_PRESETS.find((x) => x.id === id);
      if (p?.defaultBaseUrl) form.setFieldValue("baseUrl", p.defaultBaseUrl);
      if (p && p.knownModels.length) setModelList(p.knownModels);
    }
  };

  const doTest = async () => {
    const v = form.state.values;
    if (!v.baseUrl.trim()) {
      toast.error("先填写 Base URL 再测试连接");
      return;
    }
    if (!v.primary.trim()) {
      toast.error("先填写主模型再测试连接");
      return;
    }
    const body = {
      biz,
      modelId: v.primary.trim(),
      baseUrl: v.baseUrl.trim(),
      apiKey: v.apiKey.trim() || undefined,
      apiType: v.apiType,
    };
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.testModelConnection(body);
      setTestResult(r);
      if (r.ok) toast.success(`连接成功（${r.latencyMs}ms）`);
      else toast.error(`连接失败：${r.error || "未知错误"}`);
    } catch (err) {
      setTestResult({
        ok: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  // 拉模型列表：用**表单里的实时** baseUrl/key
  const refreshModels = async () => {
    const v = form.state.values;
    if (!v.baseUrl.trim()) {
      toast.error("先填写 Base URL 再拉取模型列表");
      return;
    }
    setLoadingModels(true);
    try {
      const r = await api.listModels({
        biz,
        baseUrl: v.baseUrl.trim(),
        apiKey: v.apiKey.trim() || undefined,
      });
      setModelList(r.models || []);
      if (!(r.models || []).length) toast.info("该端点未提供 /models 列表，可手动输入模型 id");
    } catch {
      setModelList([]);
    } finally {
      setLoadingModels(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">{label.title}</CardTitle>
          <CardDescription className="text-xs">{label.desc}</CardDescription>
        </div>
        <Badge variant="secondary">{biz}</Badge>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>供应商</Label>
            <form.Field name="provider">
              {(field) => (
                <Select
                  value={field.state.value}
                  onValueChange={(v) => {
                    field.handleChange(v);
                    pickProvider(v);
                  }}
                >
                  <SelectTrigger className="cursor-pointer">
                    <SelectValue placeholder="选择供应商" />
                  </SelectTrigger>
                  <SelectContent>
                    {providerOpts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </form.Field>
            <p className="text-[11px] text-slate-400">
              供应商仅作快速填充；保存后按 Base URL 反推，不影响实际调用。
            </p>
          </div>
          {biz === "imageApi" ? (
            <div className="space-y-1.5">
              <Label>生图协议</Label>
              <form.Field name="imageProtocol">
                {(f) => (
                  <Select
                    value={f.state.value}
                    onValueChange={(v) => f.handleChange(v as ImageProtocol)}
                  >
                    <SelectTrigger className="cursor-pointer">
                      <SelectValue placeholder="选择生图协议" />
                    </SelectTrigger>
                    <SelectContent>
                      {IMAGE_PROTOCOL_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}（{o.hint}）
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </form.Field>
              <p className="text-[11px] text-slate-400">
                SI-Image 走 /wand/si-image/generation，用于 TokenHub / 混元等私有生图端点。
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>API 类型</Label>
              <form.Field name="apiType">
                {(f) => (
                  <Select value={f.state.value} onValueChange={(v) => f.handleChange(v as ApiType)}>
                    <SelectTrigger className="cursor-pointer">
                      <SelectValue placeholder="选择 API 类型" />
                    </SelectTrigger>
                    <SelectContent>
                      {API_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}（{o.hint}）
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </form.Field>
              <p className="text-[11px] text-slate-400">
                Responses API 用于 OpenAI /responses 端点。
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Base URL</Label>
            <form.Field name="baseUrl">
              {(f) => (
                <Input
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                  placeholder="https://.../v1"
                  className="font-mono text-xs"
                />
              )}
            </form.Field>
          </div>
          <div className="space-y-1.5">
            <Label>API Key</Label>
            <form.Field name="apiKey">
              {(f) => (
                <PasswordInput
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                  placeholder={
                    domain.hasApiKey
                      ? `已保存 ${domain.apiKeyMasked}，留空不修改`
                      : "sk-...（本地/无鉴权可留空）"
                  }
                  className="font-mono text-xs"
                />
              )}
            </form.Field>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>主模型</Label>
            <div className="flex gap-2">
              <form.Field name="primary">
                {(f) => (
                  <Input
                    value={f.state.value}
                    onChange={(e) => f.handleChange(e.target.value)}
                    placeholder="模型 id（如 deepseek-chat）"
                    list={`models-${biz}`}
                    className="font-mono text-xs"
                  />
                )}
              </form.Field>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0 cursor-pointer"
                onClick={refreshModels}
                disabled={loadingModels}
                title="从端点拉取模型列表"
              >
                <RefreshCw className={loadingModels ? "animate-spin" : ""} />
              </Button>
            </div>
            {modelList.length > 0 && (
              <datalist id={`models-${biz}`}>
                {modelList.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            )}
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
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-2 cursor-pointer"
            onClick={doTest}
            disabled={testing}
          >
            <PlugZap /> {testing ? "测试中…" : "测试连接"}
          </Button>
          {testResult && (
            <span
              className={`inline-flex items-center gap-1 text-xs ${testResult.ok ? "text-emerald-600" : "text-rose-500"}`}
            >
              {testResult.ok ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" /> 连接正常（{testResult.latencyMs}ms）
                </>
              ) : (
                <>
                  <XCircle className="h-3.5 w-3.5" /> {testResult.error || "连接失败"}
                </>
              )}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
