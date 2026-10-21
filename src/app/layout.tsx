import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { QueryProvider } from "@/components/query-provider";
import { TaskDetailModal } from "@/components/task-detail-modal";
import { WorkflowWizard } from "@/components/workflow";
import { Toaster } from "sonner";
import { Plus_Jakarta_Sans, Lora, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const fontSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fontSerif = Lora({
  subsets: ["latin"],
  variable: "--font-serif",
});

const fontMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: "100",
});

export const metadata: Metadata = {
  title: "微信公众号 AI 漫画生产控制台",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${fontSans.variable} ${fontSerif.variable} ${fontMono.variable} min-h-screen bg-slate-100 text-slate-900 antialiased`}
      >
        <QueryProvider>
          <AppShell>{children}</AppShell>
          <WorkflowWizard />
          <TaskDetailModal />
          <Toaster richColors position="top-center" />
        </QueryProvider>
      </body>
    </html>
  );
}
