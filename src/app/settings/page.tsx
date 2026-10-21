"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

import { api } from "@/lib/api";
import type {
  AppSettingsPayload,
  AppSettingsSavePayload,
  BusinessSettingsSave,
} from "@/lib/settings-payload";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ModelDomainCard,
  type Biz,
  type DomainPatch,
} from "@/components/settings/model-domain-card";
import { GlobalCard, type GlobalPatch } from "@/components/settings/global-card";
import { BusinessCard } from "@/components/settings/business-card";

const DOMAIN_LABELS: Record<Biz, { title: string; desc: string }> = {
  main: { title: "主推理", desc: "剧本 / 主体匹配 / 本集简介（重推理）" },
  mainLight: { title: "轻量文本", desc: "选题 / 外观补全 / 标签说明书" },
  vision: { title: "多模态识别", desc: "读图 / 识图" },
  imageApi: { title: "生图", desc: "分格漫画图生成" },
};
// vision 域暂无 pipeline 调用方，先不展示；配置契约（env / AppSetting / payload）保留
const BIZS: Biz[] = ["main", "mainLight", "imageApi"];

export default function SettingsPage() {
  const [data, setData] = useState<AppSettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setData(await api.getAppSettings());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载设置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 页面把各卡切片合并进完整 payload 后整体保存，避免某卡保存把其它域/业务清空
  const buildSave = (override: (p: AppSettingsSavePayload) => void): AppSettingsSavePayload => {
    const base: AppSettingsSavePayload = {
      domains: {
        main: {
          apiType: data!.domains.main.apiType,
          imageProtocol: data!.domains.main.imageProtocol,
          primary: data!.domains.main.primary,
          baseUrl: data!.domains.main.baseUrl,
          apiKey: "",
        },
        mainLight: {
          apiType: data!.domains.mainLight.apiType,
          imageProtocol: data!.domains.mainLight.imageProtocol,
          primary: data!.domains.mainLight.primary,
          baseUrl: data!.domains.mainLight.baseUrl,
          apiKey: "",
        },
        vision: {
          apiType: data!.domains.vision.apiType,
          imageProtocol: data!.domains.vision.imageProtocol,
          primary: data!.domains.vision.primary,
          baseUrl: data!.domains.vision.baseUrl,
          apiKey: "",
        },
        imageApi: {
          apiType: data!.domains.imageApi.apiType,
          imageProtocol: data!.domains.imageApi.imageProtocol,
          primary: data!.domains.imageApi.primary,
          baseUrl: data!.domains.imageApi.baseUrl,
          apiKey: "",
        },
      },
      global: {
        autoFallback: data!.global.autoFallback,
        baseUrl: data!.global.baseUrl,
        apiKey: "",
      },
      business: {
        appid: data!.business.appid,
        appsecret: "",
        author: data!.business.author,
        stylePreset: data!.business.stylePreset,
        narrationInImage: data!.business.narrationInImage,
        imageGenConcurrency: data!.business.imageGenConcurrency,
      },
    };
    override(base);
    return base;
  };

  const onDomainPatch = async (biz: Biz, patch: DomainPatch) => {
    await api.saveAppSettings(
      buildSave((p) => {
        p.domains[biz] = { ...p.domains[biz], ...patch };
      }),
    );
    toast.success(`${biz} 域已保存，即时生效`);
    await load();
  };
  const onBusinessPatch = async (patch: BusinessSettingsSave) => {
    await api.saveAppSettings(
      buildSave((p) => {
        p.business = patch;
      }),
    );
    toast.success("业务设置已保存，即时生效");
    await load();
  };
  const onGlobalPatch = async (patch: GlobalPatch) => {
    await api.saveAppSettings(
      buildSave((p) => {
        p.global = { ...p.global, ...patch };
      }),
    );
    toast.success("全局设置已保存，即时生效");
    await load();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">设置</h1>
          <p className="mt-1 text-sm text-slate-500">模型与业务配置 · 保存后即时生效（无需重启）</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 cursor-pointer"
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} /> 刷新
        </Button>
      </div>

      {!data || loading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-60 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <Tabs defaultValue="models">
          <TabsList>
            <TabsTrigger value="models">模型配置</TabsTrigger>
            <TabsTrigger value="business">业务设置</TabsTrigger>
          </TabsList>

          <TabsContent value="models" className="space-y-4 pt-4">
            {BIZS.map((biz) => (
              <ModelDomainCard
                key={biz}
                biz={biz}
                label={DOMAIN_LABELS[biz]}
                domain={data.domains[biz]}
                onPatch={onDomainPatch}
              />
            ))}
            <GlobalCard global={data.global} onPatch={onGlobalPatch} />
          </TabsContent>

          <TabsContent value="business" className="space-y-4 pt-4">
            <BusinessCard business={data.business} onPatch={onBusinessPatch} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
