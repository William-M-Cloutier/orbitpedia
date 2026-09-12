"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/ui/AppShell";
import { BodyRail } from "@/components/ui/BodyRail";
import { BodyCard } from "@/components/ui/BodyCard";
import {
  exploreSystemHref,
  getBodiesForSystem,
  getBody,
  getHomeSystem,
  getSystem,
  isFixtureSystemId,
  KIND_LABEL,
} from "@/data/catalog";
import {
  getSystemGraphAsync,
  listSystemsAsync,
  type ArchiveSystemSummary,
} from "@/data/archiveCatalog";
import type { System } from "@/data/schema";
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

function DiscoverInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const homeId = getHomeSystem().id;
  const [systems, setSystems] = useState<
    Array<System | ArchiveSystemSummary>
  >([]);
  const [graphReady, setGraphReady] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listSystemsAsync().then((list) => {
      if (!cancelled) {
        setSystems(list.filter((s) => !isFixtureSystemId(s.id)));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const systemId = useMemo(() => {
    const p = searchParams.get("system")?.trim();
    if (p) return p;
    return homeId;
  }, [searchParams, homeId]);

  // Ensure archive graph is registered before BodyRail / charts read catalog.
  useEffect(() => {
    let cancelled = false;
    setGraphReady(false);
    getSystemGraphAsync(systemId)
      .then(() => {
        if (!cancelled) setGraphReady(true);
      })
      .catch(() => {
        if (!cancelled) setGraphReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [systemId]);

  const systemBodies = useMemo(
    () => (graphReady ? getBodiesForSystem(systemId) : []),
    [systemId, graphReady],
  );

  const defaultCompare = useMemo(() => {
    const planets = systemBodies.filter((b) => b.kind === "planet");
    return planets.slice(0, 2).map((b) => b.id);
  }, [systemBodies]);

  const [selected, setSelected] = useState<string[]>(defaultCompare);

  // Reset compare picks when switching systems (avoid silent Sol leftovers).
  useEffect(() => {
    setSelected(defaultCompare);
  }, [systemId, defaultCompare]);

  const setSystem = useCallback(
    (id: string) => {
      const params = new URLSearchParams();
      if (id !== homeId) params.set("system", id);
      const qs = params.toString();
      router.replace(qs ? `/discover?${qs}` : "/discover", { scroll: false });
      setPickerOpen(false);
    },
    [router, homeId],
  );

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

  const system = graphReady ? getSystem(systemId) : undefined;

  /** Selected first, home/Sol second (unless selected is home), then rest. */
  const orderedSystems = useMemo(() => {
    const selectedSys = systems.find((s) => s.id === systemId);
    const homeSys = systems.find((s) => s.id === homeId);
    const rest = systems.filter(
      (s) => s.id !== systemId && s.id !== homeId,
    );
    const out: Array<System | ArchiveSystemSummary> = [];
    if (selectedSys) out.push(selectedSys);
    if (homeSys && homeSys.id !== systemId) out.push(homeSys);
    out.push(...rest);
    return out;
  }, [systems, systemId, homeId]);

  const selectedLabel =
    system?.name ??
    systems.find((s) => s.id === systemId)?.name ??
    systemId;

  return (
    <AppShell
      rail={
        <BodyRail
          selectMode
          selectedIds={selected}
          onToggleSelect={toggle}
          systemId={systemId}
        />
      }
    >
      <div className="mx-auto max-w-6xl space-y-8 p-6">
        <section>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-zinc-50">Discover</h1>
              <p className="mt-2 text-zinc-400">
                Browse cards and compare up to {MAX_COMPARE} bodies side by side
                within one system.
              </p>
            </div>
            <Link
              href={exploreSystemHref(systemId)}
              className="rounded-lg bg-sky-500/20 px-4 py-2 text-sm font-medium text-sky-100 hover:bg-sky-500/30"
            >
              Visit system →
            </Link>
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="flex w-full max-w-xl items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm hover:bg-white/[0.07]"
              aria-expanded={pickerOpen}
            >
              <span>
                <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  Selected system
                </span>
                <span className="mt-0.5 block font-medium text-zinc-100">
                  {selectedLabel}
                </span>
              </span>
              <span className="text-zinc-500" aria-hidden>
                {pickerOpen ? "▾" : "▸"}
              </span>
            </button>
            {pickerOpen ? (
              <div className="mt-2 max-h-64 max-w-xl overflow-y-auto rounded-lg border border-white/10 bg-zinc-950/90 p-2">
                <div className="flex flex-wrap gap-2">
                  {orderedSystems.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSystem(s.id)}
                      className={`rounded-lg px-3 py-1.5 text-sm ${
                        s.id === systemId
                          ? "bg-sky-500/25 text-sky-100"
                          : s.id === homeId
                            ? "bg-amber-500/15 text-amber-100 hover:bg-amber-500/25"
                            : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                      }`}
                    >
                      {s.name}
                      {s.id === homeId ? " · home" : ""}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {system?.blurb ? (
            <p className="mt-3 max-w-2xl text-sm text-zinc-500">{system.blurb}</p>
          ) : null}
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {systemBodies.map((b) => (
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
          <h2 className="mb-4 text-lg font-medium text-zinc-200">
            Graphs · {system?.name ?? systemId}
          </h2>
          <CatalogCharts systemId={systemId} />
        </section>
      </div>
    </AppShell>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-zinc-500">Loading Discover…</div>
      }
    >
      <DiscoverInner />
    </Suspense>
  );
}
