"use client";

import dynamic from "next/dynamic";
import type { Body } from "@/data/schema";

const ProbeDistanceChartDynamic = dynamic(
  () => import("./ProbeDistanceCharts").then((m) => m.ProbeDistanceChart),
  {
    ssr: false,
    loading: () => (
      <div className="text-sm text-zinc-500">Loading chart…</div>
    ),
  },
);

export function ProbeDistanceChartLazy({ body }: { body: Body }) {
  return <ProbeDistanceChartDynamic body={body} />;
}
