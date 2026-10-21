import type { Metadata } from "next";

import { SeriesLibrary } from "@/components/series/series-library";

export const metadata: Metadata = { title: "合集" };

export default function SeriesPage() {
  return (
    <div className="mx-auto">
      <SeriesLibrary />
    </div>
  );
}
