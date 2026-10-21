"use client";

import { Fragment } from "react";

import { usePathname } from "next/navigation";
import Link from "next/link";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Sidebar } from "./sidebar";

/** 按当前路由生成面包屑（首页不可点击，末级为当前页） */
function buildCrumbs(pathname: string): Array<{ label: string; href?: string }> {
  const crumbs: Array<{ label: string; href?: string }> = [{ label: "任务列表", href: "/" }];
  if (pathname.startsWith("/tasks/")) {
    crumbs.push({ label: "任务详情" });
  } else if (pathname.startsWith("/assets")) {
    crumbs.push({ label: "主体资产库" });
  } else if (pathname.startsWith("/series")) {
    crumbs.push({ label: "合集" });
  } else if (pathname.startsWith("/settings")) {
    crumbs.push({ label: "设置" });
  } else if (pathname !== "/") {
    crumbs.push({ label: "任务详情" });
  }
  return crumbs;
}

/** 管理后台总体布局：可收起 Sidebar + 顶栏（当前页标题 + 流水线提示）+ 内容区 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-6 backdrop-blur">
          <Breadcrumb aria-label="页面路径">
            <BreadcrumbList>
              {buildCrumbs(pathname).map((c, i, arr) => (
                <Fragment key={i}>
                  {i > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {i < arr.length - 1 && c.href ? (
                      <Link
                        href={c.href}
                        className="text-slate-500 transition-colors hover:text-slate-900"
                      >
                        {c.label}
                      </Link>
                    ) : (
                      <BreadcrumbPage>{c.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
          <p className="hidden text-xs text-slate-400 md:block">
            通道选择 → 剧本创作 → 主体确认 → 漫画生成 → 人工审核 → 发布
          </p>
        </header>
        <main className="min-w-0 flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
