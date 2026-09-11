"use client";

import dynamic from "next/dynamic";

const CatalogChartsDynamic = dynamic(
  () => import("./charts").then((m) => m.CatalogCharts),
  {
    ssr: false,
    loading: () => (
      <div className="text-sm text-zinc-500">Loading charts…</div>
    ),
  },
);

type Props = { systemId?: string; focusId?: string };

export function CatalogChartsLazy({ systemId, focusId }: Props) {
  return <CatalogChartsDynamic systemId={systemId} focusId={focusId} />;
}
