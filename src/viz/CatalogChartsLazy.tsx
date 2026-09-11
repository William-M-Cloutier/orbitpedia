"use client";

import dynamic from "next/dynamic";

export const CatalogChartsLazy = dynamic(
  () => import("./charts").then((m) => m.CatalogCharts),
  {
    ssr: false,
    loading: () => (
      <div className="text-sm text-zinc-500">Loading charts…</div>
    ),
  },
);
