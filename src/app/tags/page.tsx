import type { Metadata } from "next";

import { TagLibrary } from "@/components/tags/tag-library";

export const metadata: Metadata = { title: "标签库" };

export default function TagsPage() {
  return <TagLibrary />;
}
