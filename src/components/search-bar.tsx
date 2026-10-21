"use client";

import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { STATUS_META } from "@/lib/status";
import { useUiStore } from "@/store/ui";

export function SearchBar() {
  const search = useUiStore((s) => s.search);
  const setSearch = useUiStore((s) => s.setSearch);
  const resetSearch = useUiStore((s) => s.resetSearch);

  const [q, setQ] = useState(search.q);
  const [status, setStatus] = useState(search.status);
  const [from, setFrom] = useState(search.from);
  const [to, setTo] = useState(search.to);
  const [id, setId] = useState(search.id);
  const [seriesId, setSeriesId] = useState(search.seriesId);
  const [tagId, setTagId] = useState(search.tagId);
  const { data: seriesData } = useQuery({
    queryKey: ["series"],
    queryFn: () => api.getSeries(),
    retry: false,
  });
  const seriesList = seriesData?.series ?? [];
  const { data: tagsData } = useQuery({
    queryKey: ["tags"],
    queryFn: () => api.getTags(),
    retry: false,
  });
  const tagList = tagsData?.tags ?? [];

  function onSearch() {
    setSearch({ q: q.trim(), status, from, to, id: id.trim(), seriesId, tagId });
  }

  function onReset() {
    setQ("");
    setStatus("");
    setFrom("");
    setTo("");
    setId("");
    setSeriesId("");
    setTagId("");
    resetSearch();
  }

  return (
    <section className="rounded-xl bg-white p-4 shadow-sm">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
      >
        <Label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          标题 / 关键词
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="模糊搜索标题或大纲"
            className="w-52"
          />
        </Label>
        <Label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          文章状态
          <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="全部" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              {Object.entries(STATUS_META).map(([value, meta]) => (
                <SelectItem key={value} value={value}>
                  {meta.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
        <Label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          合集
          <Select
            value={seriesId || "all"}
            onValueChange={(v) => setSeriesId(v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="全部" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="none">无合集任务</SelectItem>
              {seriesList.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
        <Label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          内容标签
          <Select value={tagId || "all"} onValueChange={(v) => setTagId(v === "all" ? "" : v)}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="全部" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              {tagList.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
        <Label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          生成时间从
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-2"
          />
        </Label>
        <Label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          至
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-2" />
        </Label>
        <Label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          任务 ID / 草稿 ID
          <Input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="精确匹配"
            className="w-44"
          />
        </Label>
        <div className="flex gap-2">
          <Button
            type="submit"
            className="h-9 bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700"
          >
            搜索
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onReset}
            className="h-9 border-slate-300 px-4 text-sm text-slate-600 hover:bg-slate-50"
          >
            重置
          </Button>
        </div>
      </form>
    </section>
  );
}
