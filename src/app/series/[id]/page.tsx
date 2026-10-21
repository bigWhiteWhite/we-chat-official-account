import type { Metadata } from "next";

import { SeriesDetail } from "@/components/series/series-detail";

export const metadata: Metadata = { title: "合集详情" };

export default async function SeriesDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SeriesDetail seriesId={id} />;
}
