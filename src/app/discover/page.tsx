"use client";

import { useCallback, useMemo, useState } from "react";
import { AppShell } from "@/components/ui/AppShell";
import { BodyRail } from "@/components/ui/BodyRail";
import { BodyCard } from "@/components/ui/BodyCard";
import { bodies, getBody, KIND_LABEL } from "@/data/catalog";
import {
  formatAu,
  formatDensity,
  formatMass,
  formatPeriodDays,
  formatRadius,
} from "@/lib/units";
import { periodFromA } from "@/lib/kepler";
import { CatalogCharts } from "@/viz/charts";

const MAX_COMPARE = 4;

export default function DiscoverPage() {
  const [selected, setSelected] = useState<string[]>(["earth", "mars"]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COMPARE) return [...prev.slice(1), id];
      return [...prev, id];
    });
  }, []);

  const compared = useMemo(
    () => selected.map((id) => getBody(id)).filter(Boolean),
    [selected],
  );

  return (
    <AppShell
      rail={
        <BodyRail
          selectMode
          selectedIds={selected}
          onToggleSelect={toggle}
        />
      }
    >
      <div className="mx-auto max-w-6xl space-y-8 p-6">
        <section>
          <h1 className="text-2xl font-semibold text-zinc-50">Discover</h1>
          <p className="mt-2 text-zinc-400">
            Browse cards and compare up to {MAX_COMPARE} bodies side by side.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {bodies.map((b) => (
            <BodyCard
              key={b.id}
              body={b}
              selected={selected.includes(b.id)}
              onSelect={() => toggle(b.id)}
            />
          ))}
        </section>

        {compared.length > 0 && (
          <section>
            <h2 className="mb-3 text-lg font-medium text-zinc-200">
              Compare ({compared.length}/{MAX_COMPARE})
            </h2>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-white/5 text-zinc-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Property</th>
                    {compared.map((b) => (
                      <th key={b!.id} className="px-3 py-2 font-medium text-zinc-200">
                        {b!.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {(
                    [
                      ["Kind", (b) => KIND_LABEL[b.kind]],
                      ["Mass", (b) => (b.facts.massKg != null ? formatMass(b.facts.massKg) : "—")],
                      ["Radius", (b) => (b.facts.radiusMeanKm != null ? formatRadius(b.facts.radiusMeanKm) : "—")],
                      [
                        "Density",
                        (b) =>
                          b.facts.densityGcm3 != null
                            ? formatDensity(b.facts.densityGcm3)
                            : "—",
                      ],
                      [
                        "a",
                        (b) => (b.orbit ? formatAu(b.orbit.aAu) : "—"),
                      ],
                      [
                        "e",
                        (b) =>
                          b.orbit ? b.orbit.e.toPrecision(3) : "—",
                      ],
                      [
                        "Period",
                        (b) => {
                          if (!b.orbit) return "—";
                          const p =
                            b.orbit.periodD ?? periodFromA(b.orbit.aAu);
                          return formatPeriodDays(p);
                        },
                      ],
                    ] as Array<[string, (b: NonNullable<(typeof compared)[0]>) => string]>
                  ).map(([label, fn]) => (
                    <tr key={label}>
                      <td className="px-3 py-2 text-zinc-500">{label}</td>
                      {compared.map((b) => (
                        <td key={b!.id} className="px-3 py-2 text-zinc-200">
                          {fn(b!)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-4 text-lg font-medium text-zinc-200">Graphs</h2>
          <CatalogCharts />
        </section>
      </div>
    </AppShell>
  );
}
