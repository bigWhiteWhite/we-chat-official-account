import type { Metadata } from "next";

import { AssetLibrary } from "@/components/assets/asset-library";

export const metadata: Metadata = { title: "主体资产库" };

export default async function AssetsPage(props: { searchParams: Promise<{ seriesId?: string }> }) {
  const searchParams = await props.searchParams;
  return (
    <div className="mx-auto">
      <AssetLibrary defaultSeriesId={searchParams.seriesId} />
    </div>
  );
}
