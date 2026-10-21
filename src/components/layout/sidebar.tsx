"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Layers,
  Library,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  Tags,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

const NAV_ITEMS = [
  { href: "/", label: "任务列表", icon: ListTodo, exact: true },
  { href: "/assets", label: "主体资产库", icon: Library, exact: false },
  { href: "/series", label: "合集", icon: Layers, exact: false },
  { href: "/tags", label: "标签库", icon: Tags, exact: false },
  { href: "/settings", label: "设置", icon: Settings, exact: false },
] as const;

const STORAGE_KEY = "sidebar-collapsed";

/** 左侧导航：可收起（记忆到 localStorage），任务列表 / 主体资产库 */
export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [refreshingToken, setRefreshingToken] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* 无 localStorage（SSR/测试）时忽略 */
    }
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const refreshWeixinToken = async () => {
    if (refreshingToken) return;
    setRefreshingToken(true);
    try {
      await api.refreshWeixinToken();
      toast.success("微信 access_token 已刷新");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刷新微信 access_token 失败");
    } finally {
      setRefreshingToken(false);
    }
  };

  return (
    <aside
      className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 ${
        collapsed ? "w-[68px]" : "w-60"
      }`}
    >
      <div
        className={`flex h-14 items-center border-b border-slate-100 ${collapsed ? "justify-center px-2" : "gap-2.5 px-4"}`}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-900 text-sm font-bold text-white">
          漫
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-4 text-slate-900">AI 漫画生产</p>
            <p className="truncate text-[11px] text-slate-400">公众号自动发布</p>
          </div>
        )}
        {!collapsed && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={refreshWeixinToken}
            disabled={refreshingToken}
            title="刷新微信 access_token（出口 IP 变化 / 40164 后使用）"
            className="ml-auto text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <RefreshCw className={refreshingToken ? "animate-spin" : undefined} />
          </Button>
        )}
      </div>

      <nav className={`flex-1 space-y-1 py-3 ${collapsed ? "px-2.5" : "px-3"}`}>
        {NAV_ITEMS.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={`flex items-center rounded-lg text-sm transition-colors ${
                collapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-3 py-2"
              } ${
                active ? "bg-slate-900 font-medium text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-100 p-2.5">
        <Button
          type="button"
          variant="ghost"
          onClick={toggle}
          title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          className={`w-full justify-start rounded-lg py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 ${
            collapsed ? "justify-center" : "gap-2.5 px-3"
          }`}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
          {!collapsed && <span>收起</span>}
        </Button>
      </div>
    </aside>
  );
}
