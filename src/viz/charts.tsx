"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ZAxis,
  CartesianGrid,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import {
  getBodiesForSystem,
  getBody,
  getHomeSystem,
  getSystem,
  hasUsableOrbit,
  listChildren,
} from "@/data/catalog";
import type { Body, BodyKind } from "@/data/schema";
import { periodFromA } from "@/lib/kepler";
import {
  AU_KM,
  EARTH_MASS_KG,
  EARTH_RADIUS_KM,
  formatDensity,
  formatMass,
  formatPeriodDays,
  formatRadius,
} from "@/lib/units";

const tipStyle = {
  background: "#0c1220",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  fontSize: 12,
};

/** Short sci / 2–3 sig — no raw float dumps (`1.3e-4`, `0.024`). */
function formatShortNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e3 || abs < 1e-2) {
    return v
      .toExponential(1)
      .replace(/e\+/, "e")
      .replace(/e(-?)0+(\d)/, "e$1$2");
  }
  return String(Number(v.toPrecision(3)));
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="mb-3 text-sm font-medium text-zinc-300">{title}</h3>
      <div className="h-64 w-full">{children}</div>
    </div>
  );
}

type ChartsProps = {
  /** Scope series to one system graph — never silent Sol for exoplanet pages. */
  systemId?: string;
  /** Body page focus — scopes which kind sections appear + highlight. */
  focusId?: string;
};

type ChartSection = {
  key: string;
  title: string;
  subset: Body[];
  distanceSubject: "host" | "parent";
  /** Parent name when distanceSubject is parent. */
  parentName?: string;
  focusId?: string;
  /** Optional chip / link row under the section title. */
  headerExtra?: React.ReactNode;
};

function useSystemBodies(systemId?: string) {
  return useMemo(() => {
    const id = systemId ?? getHomeSystem().id;
    return getBodiesForSystem(id);
  }, [systemId]);
}

function hostLabel(systemId?: string): string {
  const id = systemId ?? getHomeSystem().id;
  const sys = getSystem(id);
  const members = getBodiesForSystem(id);
  const star =
    members.find((b) => b.kind === "star" && !b.parentId) ??
    members.find((b) => b.kind === "star");
  if (star) return star.name;
  return sys?.name ?? "host";
}

function filterKinds(bodies: Body[], kinds: readonly BodyKind[]): Body[] {
  const set = new Set<BodyKind>(kinds);
  return bodies.filter((b) => set.has(b.kind));
}

function moonChildrenOf(parentId: string, systemBodies: Body[]): Body[] {
  const inSystem = new Set(systemBodies.map((b) => b.id));
  return listChildren(parentId).filter(
    (b) => b.kind === "moon" && inSystem.has(b.id),
  );
}

/** Parents with ≥2 moons in this system (comparison-worthy), sorted desc. */
function moonParentOptions(systemBodies: Body[]): {
  parent: Body;
  count: number;
}[] {
  const counts = new Map<string, number>();
  for (const b of systemBodies) {
    if (b.kind !== "moon" || !b.parentId) continue;
    counts.set(b.parentId, (counts.get(b.parentId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([id, count]) => {
      const parent = getBody(id);
      return parent ? { parent, count } : null;
    })
    .filter((x): x is { parent: Body; count: number } => x != null)
    .sort(
      (a, b) =>
        b.count - a.count || a.parent.name.localeCompare(b.parent.name),
    );
}

function groupHasChartData(bodies: Body[]): boolean {
  const hasMassRadius = bodies.some(
    (b) =>
      b.kind !== "star" &&
      b.facts.massKg != null &&
      b.facts.radiusMeanKm != null,
  );
  const hasOrbit = bodies.some((b) => hasUsableOrbit(b));
  return hasMassRadius || hasOrbit;
}

function cellStyle(id: string, fill: string, focusId?: string) {
  const isFocus = focusId != null && id === focusId;
  const muted = focusId != null && id !== focusId;
  return {
    fill,
    fillOpacity: muted ? 0.35 : 1,
    stroke: isFocus ? "#f8fafc" : undefined,
    strokeWidth: isFocus ? 2 : 0,
  };
}

function MassRadiusChart({
  bodies,
  title,
  focusId,
}: {
  bodies: Body[];
  title: string;
  focusId?: string;
}) {
  const massRadiusData = useMemo(
    () =>
      bodies
        .filter(
          (b) =>
            b.kind !== "star" &&
            b.facts.massKg != null &&
            b.facts.radiusMeanKm != null,
        )
        .map((b) => ({
          id: b.id,
          name: b.name,
          massMe: (b.facts.massKg as number) / EARTH_MASS_KG,
          radiusRe: (b.facts.radiusMeanKm as number) / EARTH_RADIUS_KM,
          fill: b.color ?? "#888",
        })),
    [bodies],
  );

  if (massRadiusData.length === 0) {
    return (
      <ChartCard title={title}>
        <p className="flex h-full items-center justify-center text-sm text-zinc-500">
          No mass+radius pairs in this group
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard title={title}>
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" />
          <XAxis
            type="number"
            dataKey="massMe"
            name="Mass"
            unit=" M⊕"
            scale="log"
            domain={["auto", "auto"]}
            stroke="#71717a"
            tick={{ fontSize: 11 }}
            tickFormatter={formatShortNumber}
            label={{
              value: "Mass (M⊕)",
              position: "insideBottom",
              offset: -8,
              fill: "#71717a",
              fontSize: 11,
            }}
          />
          <YAxis
            type="number"
            dataKey="radiusRe"
            name="Radius"
            unit=" R⊕"
            scale="log"
            domain={["auto", "auto"]}
            stroke="#71717a"
            tick={{ fontSize: 11 }}
            tickFormatter={formatShortNumber}
            width={52}
            label={{
              value: "Radius (R⊕)",
              angle: -90,
              position: "insideLeft",
              offset: 12,
              fill: "#71717a",
              fontSize: 11,
            }}
          />
          <ZAxis range={[80, 80]} />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            contentStyle={tipStyle}
            formatter={(v, name) => [
              typeof v === "number" ? formatShortNumber(v) : String(v),
              String(name),
            ]}
            labelFormatter={(_, payload) =>
              payload?.[0]?.payload?.name ?? ""
            }
          />
          <Scatter data={massRadiusData} fill="#38bdf8">
            {massRadiusData.map((d) => {
              const s = cellStyle(d.id, d.fill, focusId);
              return (
                <Cell
                  key={d.id}
                  fill={s.fill}
                  fillOpacity={s.fillOpacity}
                  stroke={s.stroke}
                  strokeWidth={s.strokeWidth}
                />
              );
            })}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function APeriodChart({
  bodies,
  title,
  focusId,
}: {
  bodies: Body[];
  title: string;
  focusId?: string;
}) {
  const aPeriodData = useMemo(() => {
    const orbiters = bodies.filter((b) => hasUsableOrbit(b));
    return orbiters.map((b) => {
      const a = b.orbit!.aAu;
      const p = b.orbit!.periodD ?? periodFromA(a);
      return {
        id: b.id,
        name: b.name,
        aAu: a,
        periodYr: p / 365.25,
        fill: b.color ?? "#888",
      };
    });
  }, [bodies]);

  if (aPeriodData.length === 0) {
    return (
      <ChartCard title={title}>
        <p className="flex h-full items-center justify-center text-sm text-zinc-500">
          No orbits in this group
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard title={title}>
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" />
          <XAxis
            type="number"
            dataKey="aAu"
            name="a"
            unit=" AU"
            scale="log"
            domain={["auto", "auto"]}
            stroke="#71717a"
            tick={{ fontSize: 11 }}
            tickFormatter={formatShortNumber}
            label={{
              value: "a (AU)",
              position: "insideBottom",
              offset: -8,
              fill: "#71717a",
              fontSize: 11,
            }}
          />
          <YAxis
            type="number"
            dataKey="periodYr"
            name="Period"
            unit=" yr"
            scale="log"
            domain={["auto", "auto"]}
            stroke="#71717a"
            tick={{ fontSize: 11 }}
            tickFormatter={formatShortNumber}
            width={52}
            label={{
              value: "Period (yr)",
              angle: -90,
              position: "insideLeft",
              offset: 12,
              fill: "#71717a",
              fontSize: 11,
            }}
          />
          <ZAxis range={[80, 80]} />
          <Tooltip
            contentStyle={tipStyle}
            formatter={(v, name) => [
              typeof v === "number" ? formatShortNumber(v) : String(v),
              String(name),
            ]}
            labelFormatter={(_, payload) =>
              payload?.[0]?.payload?.name ?? ""
            }
          />
          <Scatter data={aPeriodData}>
            {aPeriodData.map((d) => {
              const s = cellStyle(d.id, d.fill, focusId);
              return (
                <Cell
                  key={d.id}
                  fill={s.fill}
                  fillOpacity={s.fillOpacity}
                  stroke={s.stroke}
                  strokeWidth={s.strokeWidth}
                />
              );
            })}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function DistanceBarChart({
  bodies,
  title,
  focusId,
}: {
  bodies: Body[];
  title: string;
  focusId?: string;
}) {
  const distanceData = useMemo(() => {
    const orbiters = bodies.filter((b) => hasUsableOrbit(b));
    return orbiters
      .map((b) => ({
        id: b.id,
        label:
          b.name.length > 14
            ? b.id.includes("-")
              ? b.id.slice(b.id.lastIndexOf("-") + 1).toUpperCase()
              : b.name.slice(0, 12)
            : b.name,
        name: b.name,
        aAu: b.orbit!.aAu,
        fill: b.color ?? "#888",
      }))
      .sort((a, b) => a.aAu - b.aAu);
  }, [bodies]);

  if (distanceData.length === 0) {
    return (
      <ChartCard title={title}>
        <p className="flex h-full items-center justify-center text-sm text-zinc-500">
          No orbits in this group
        </p>
      </ChartCard>
    );
  }

  const n = distanceData.length;
  const horizontal = n >= 6;
  // Tight category axis: hide every other label; never rotate into smear.
  const hideEveryOther = n >= 8;
  const categoryTick = (value: string, index: number) =>
    hideEveryOther && index % 2 === 1 ? "" : value;

  if (horizontal) {
    return (
      <ChartCard title={title}>
        <ResponsiveContainer>
          <BarChart
            layout="vertical"
            data={distanceData}
            margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
          >
            <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
            <XAxis
              type="number"
              stroke="#71717a"
              tick={{ fontSize: 11 }}
              tickFormatter={formatShortNumber}
              unit=" AU"
            />
            <YAxis
              type="category"
              dataKey="label"
              stroke="#71717a"
              tick={{ fontSize: n > 10 ? 9 : 11 }}
              width={72}
              interval={0}
              tickFormatter={categoryTick}
            />
            <Tooltip
              contentStyle={tipStyle}
              labelFormatter={(_, payload) =>
                payload?.[0]?.payload?.name ?? ""
              }
              formatter={(v) => [
                typeof v === "number"
                  ? `${formatShortNumber(v)} AU`
                  : String(v),
                "a",
              ]}
            />
            <Bar dataKey="aAu" name="a (AU)" radius={[0, 4, 4, 0]}>
              {distanceData.map((d) => {
                const s = cellStyle(d.id, d.fill, focusId);
                return (
                  <Cell
                    key={d.id}
                    fill={s.fill}
                    fillOpacity={s.fillOpacity}
                    stroke={s.stroke}
                    strokeWidth={s.strokeWidth}
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    );
  }

  return (
    <ChartCard title={title}>
      <ResponsiveContainer>
        <BarChart
          data={distanceData}
          margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="#71717a"
            tick={{ fontSize: 11 }}
            interval={0}
            angle={0}
            textAnchor="middle"
            height={28}
            tickFormatter={categoryTick}
          />
          <YAxis
            stroke="#71717a"
            tick={{ fontSize: 11 }}
            tickFormatter={formatShortNumber}
            width={48}
            unit=" AU"
          />
          <Tooltip
            contentStyle={tipStyle}
            labelFormatter={(_, payload) =>
              payload?.[0]?.payload?.name ?? ""
            }
            formatter={(v) => [
              typeof v === "number"
                ? `${formatShortNumber(v)} AU`
                : String(v),
              "a",
            ]}
          />
          <Bar dataKey="aAu" name="a (AU)" radius={[4, 4, 0, 0]}>
            {distanceData.map((d) => {
              const s = cellStyle(d.id, d.fill, focusId);
              return (
                <Cell
                  key={d.id}
                  fill={s.fill}
                  fillOpacity={s.fillOpacity}
                  stroke={s.stroke}
                  strokeWidth={s.strokeWidth}
                />
              );
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function SectionCharts({
  section,
  host,
}: {
  section: ChartSection;
  host: string;
}) {
  const distTitle =
    section.distanceSubject === "parent"
      ? `${section.title}: distance from ${section.parentName ?? "parent"} (semi-major axis)`
      : `${section.title}: distance from ${host} (semi-major axis)`;
  const focusId = section.focusId;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-zinc-200">
          {section.title}
        </h3>
        {section.headerExtra}
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {section.subset.some(
          (b) =>
            b.kind !== "star" &&
            b.facts.massKg != null &&
            b.facts.radiusMeanKm != null,
        ) ? (
          <MassRadiusChart
            bodies={section.subset}
            title={`${section.title}: mass vs radius (Earth units)`}
            focusId={focusId}
          />
        ) : null}
        {section.subset.some((b) => hasUsableOrbit(b)) ? (
          <>
            <APeriodChart
              bodies={section.subset}
              title={`${section.title}: semi-major axis vs orbital period`}
              focusId={focusId}
            />
            <DistanceBarChart
              bodies={section.subset}
              title={distTitle}
              focusId={focusId}
            />
          </>
        ) : null}
      </div>
    </section>
  );
}

function MoonParentPicker({
  options,
  selectedId,
  onSelect,
}: {
  options: { parent: Body; count: number }[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(({ parent, count }) => (
        <button
          key={parent.id}
          type="button"
          onClick={() => onSelect(parent.id)}
          className={`rounded-full px-2.5 py-1 text-xs ${
            parent.id === selectedId
              ? "bg-sky-500/30 text-sky-100 ring-1 ring-sky-400/50"
              : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
          }`}
        >
          {parent.name}
          <span className="ml-1 opacity-60">{count}</span>
        </button>
      ))}
    </div>
  );
}

function orbitAKm(body: Body): number | null {
  if (!hasUsableOrbit(body)) return null;
  return body.orbit!.aAu * AU_KM;
}

function aInParentRadii(moon: Body, parent: Body): number | null {
  const aKm = orbitAKm(moon);
  const r = parent.facts.radiusMeanKm;
  if (aKm == null || r == null || r <= 0) return null;
  return aKm / r;
}

function periodDaysOf(body: Body): number | null {
  if (!body.orbit) return null;
  if (body.orbit.periodD != null) return body.orbit.periodD;
  if (hasUsableOrbit(body)) return periodFromA(body.orbit.aAu);
  return null;
}

function shortRatio(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 100 || v < 0.01) return formatShortNumber(v);
  return String(Number(v.toPrecision(3)));
}

/** Two discs scaled by radiusMeanKm + mass ratio caption (planet vs its only moon). */
function SizePair({
  larger,
  smaller,
}: {
  larger: Body;
  smaller: Body;
}) {
  const rL = larger.facts.radiusMeanKm;
  const rS = smaller.facts.radiusMeanKm;
  if (rL == null || rS == null || rL <= 0 || rS <= 0) return null;

  const dL = 112;
  // Keep the larger body fixed; scale the other by radius ratio.
  const sizeA = rL >= rS ? dL : Math.max(18, (rL / rS) * dL);
  const sizeB = rS >= rL ? dL : Math.max(18, (rS / rL) * dL);

  const mL = larger.facts.massKg;
  const mS = smaller.facts.massKg;
  const massCaption =
    mL != null && mS != null && mS > 0
      ? `Mass ratio ${larger.name} / ${smaller.name}: ${shortRatio(mL / mS)}×`
      : mL != null && mS != null && mL > 0
        ? `Mass ratio ${smaller.name} / ${larger.name}: ${shortRatio(mS / mL)}×`
        : null;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="mb-3 text-sm font-medium text-zinc-300">Size pair</h3>
      <div className="flex items-end justify-center gap-8 py-4">
        <div className="flex flex-col items-center gap-2">
          <div
            className="rounded-full shadow-[inset_0_-8px_24px_rgba(0,0,0,0.35)]"
            style={{
              width: sizeA,
              height: sizeA,
              background: larger.color ?? "#888",
            }}
            title={`${larger.name}: ${formatRadius(rL)}`}
          />
          <div className="text-center">
            <div className="text-sm text-zinc-200">{larger.name}</div>
            <div className="text-[11px] text-zinc-500">{formatRadius(rL)}</div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div
            className="rounded-full shadow-[inset_0_-6px_16px_rgba(0,0,0,0.35)]"
            style={{
              width: sizeB,
              height: sizeB,
              background: smaller.color ?? "#888",
            }}
            title={`${smaller.name}: ${formatRadius(rS)}`}
          />
          <div className="text-center">
            <div className="text-sm text-zinc-200">{smaller.name}</div>
            <div className="text-[11px] text-zinc-500">{formatRadius(rS)}</div>
          </div>
        </div>
      </div>
      {massCaption ? (
        <p className="mt-1 text-center text-xs text-zinc-400">{massCaption}</p>
      ) : null}
      <p className="mt-1 text-center text-[11px] text-zinc-600">
        Discs scaled by mean radius (not mass)
      </p>
    </div>
  );
}

/** Moon semi-major axis in parent radii — readable “how far out”. */
function HowFarOut({ parent, moon }: { parent: Body; moon: Body }) {
  const radii = aInParentRadii(moon, parent);
  const aKm = orbitAKm(moon);
  if (radii == null && aKm == null) return null;

  const maxR = 60; // visual scale cap for the marker track
  const markerPct =
    radii != null ? Math.min(96, Math.max(6, (radii / maxR) * 100)) : 50;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="mb-3 text-sm font-medium text-zinc-300">How far out</h3>
      <div className="relative mx-auto mt-2 h-16 max-w-md">
        <div className="absolute left-0 top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-white/10" />
        <div
          className="absolute left-0 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full"
          style={{ background: parent.color ?? "#888" }}
          title={parent.name}
        />
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white/40"
          style={{
            left: `calc(${markerPct}% )`,
            background: moon.color ?? "#a1a1aa",
          }}
          title={moon.name}
        />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-center text-sm">
        {radii != null ? (
          <div className="rounded-lg bg-white/[0.03] px-2 py-2">
            <dt className="text-[11px] text-zinc-500">
              a / R<sub className="text-[9px]">{parent.name[0]}</sub>
            </dt>
            <dd className="font-medium text-zinc-100">
              {shortRatio(radii)} parent radii
            </dd>
          </div>
        ) : null}
        {aKm != null ? (
          <div className="rounded-lg bg-white/[0.03] px-2 py-2">
            <dt className="text-[11px] text-zinc-500">Semi-major axis</dt>
            <dd className="font-medium text-zinc-100">
              {aKm >= 1e6
                ? `${shortRatio(aKm / 1e6)} M km`
                : `${shortRatio(aKm / 1e3)} ×10³ km`}
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="mt-2 text-center text-[11px] text-zinc-600">
        <Link
          href={`/body/${moon.id}`}
          className="text-sky-400/80 hover:text-sky-300"
        >
          {moon.name} →
        </Link>
        {" · "}
        not system AU
      </p>
    </div>
  );
}

/** Horizontal ladder of moon distances in parent-radii (fallback: 1000 km). */
function OrbitLadder({
  parent,
  moons,
}: {
  parent: Body;
  moons: Body[];
}) {
  const rows = moons
    .map((m) => {
      const radii = aInParentRadii(m, parent);
      const aKm = orbitAKm(m);
      return {
        id: m.id,
        name: m.name,
        fill: m.color ?? "#888",
        radii,
        aKm,
        sort: radii ?? (aKm != null ? aKm / (parent.facts.radiusMeanKm ?? 1) : null),
      };
    })
    .filter((r) => r.sort != null)
    .sort((a, b) => (a.sort as number) - (b.sort as number));

  if (rows.length === 0) return null;

  const useRadii = rows.every((r) => r.radii != null);
  const maxVal = Math.max(
    ...rows.map((r) => (useRadii ? (r.radii as number) : (r.aKm as number) / 1000)),
  );

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="mb-3 text-sm font-medium text-zinc-300">
        Orbit ladder · from {parent.name} (
        {useRadii ? "parent radii" : "×10³ km"})
      </h3>
      <ul className="space-y-2">
        {rows.map((r) => {
          const val = useRadii ? (r.radii as number) : (r.aKm as number) / 1000;
          const pct = Math.max(4, (val / maxVal) * 100);
          return (
            <li key={r.id} className="flex items-center gap-2 text-xs">
              <Link
                href={`/body/${r.id}`}
                className="w-20 shrink-0 truncate text-zinc-300 hover:text-sky-300"
              >
                {r.name}
              </Link>
              <div className="relative h-3 flex-1 rounded bg-white/5">
                <div
                  className="absolute inset-y-0 left-0 rounded"
                  style={{ width: `${pct}%`, background: r.fill, opacity: 0.85 }}
                />
              </div>
              <span className="w-16 shrink-0 text-right font-mono text-[11px] text-zinc-400">
                {shortRatio(val)}
                {useRadii ? " R" : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Moon page: parent link + a in parent-radii, period, mass fraction. */
function ParentContextCard({ moon, parent }: { moon: Body; parent: Body }) {
  const radii = aInParentRadii(moon, parent);
  const period = periodDaysOf(moon);
  const mM = moon.facts.massKg;
  const mP = parent.facts.massKg;
  const massFrac =
    mM != null && mP != null && mP > 0 ? mM / mP : null;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-300">Parent context</h3>
        <Link
          href={`/body/${parent.id}`}
          className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
        >
          {parent.name} →
        </Link>
      </div>
      <dl className="grid gap-2 sm:grid-cols-3">
        {radii != null ? (
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <dt className="text-[11px] text-zinc-500">a in parent radii</dt>
            <dd className="text-sm text-zinc-100">{shortRatio(radii)} R</dd>
          </div>
        ) : null}
        {period != null ? (
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <dt className="text-[11px] text-zinc-500">Orbital period</dt>
            <dd className="text-sm text-zinc-100">
              {formatPeriodDays(period)}
            </dd>
          </div>
        ) : null}
        {massFrac != null ? (
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <dt className="text-[11px] text-zinc-500">Mass fraction</dt>
            <dd className="text-sm text-zinc-100">
              {shortRatio(massFrac * 100)}% of {parent.name}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function dialPct(value: number, ref: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(ref) || ref <= 0) return 0;
  // log-ish compression so tiny moons still show a sliver
  const ratio = value / ref;
  return Math.min(100, Math.max(3, (Math.log10(ratio + 0.01) + 2) / 4 * 100));
}

/** Compact dials vs Earth (or parent) for radius/mass/density/albedo. */
function BodyDials({
  body,
  vs,
}: {
  body: Body;
  vs: Body;
}) {
  const dials: { key: string; label: string; bodyVal: number | null | undefined; refVal: number | null | undefined; format: (n: number) => string }[] = [
    {
      key: "radius",
      label: "Radius",
      bodyVal: body.facts.radiusMeanKm,
      refVal: vs.facts.radiusMeanKm,
      format: (n) => formatRadius(n),
    },
    {
      key: "mass",
      label: "Mass",
      bodyVal: body.facts.massKg,
      refVal: vs.facts.massKg,
      format: (n) => formatMass(n),
    },
    {
      key: "density",
      label: "Density",
      bodyVal: body.facts.densityGcm3,
      refVal: vs.facts.densityGcm3,
      format: (n) => formatDensity(n),
    },
    {
      key: "albedo",
      label: "Albedo",
      bodyVal: body.facts.albedo,
      refVal: vs.facts.albedo,
      format: (n) => n.toPrecision(3),
    },
  ];

  const usable = dials.filter(
    (d) => d.bodyVal != null && d.refVal != null && (d.refVal as number) > 0,
  );
  if (usable.length === 0) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="mb-3 text-sm font-medium text-zinc-300">
        Body dials · vs {vs.name}
      </h3>
      <ul className="space-y-3">
        {usable.map((d) => {
          const bv = d.bodyVal as number;
          const rv = d.refVal as number;
          const ratio = bv / rv;
          return (
            <li key={d.key}>
              <div className="mb-1 flex justify-between text-[11px]">
                <span className="text-zinc-400">{d.label}</span>
                <span className="text-zinc-500">
                  {d.format(bv)}
                  <span className="mx-1 text-zinc-600">·</span>
                  {shortRatio(ratio)}× {vs.name}
                </span>
              </div>
              <div className="h-2 rounded-full bg-white/5">
                <div
                  className="h-2 rounded-full"
                  style={{
                    width: `${dialPct(bv, rv)}%`,
                    background: body.color ?? "#38bdf8",
                    opacity: 0.9,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Moon compare section: mass–radius + a–period when useful; orbit ladder (not host AU). */
function MoonsOfSection({
  parent,
  moons,
  headerExtra,
}: {
  parent: Body;
  moons: Body[];
  headerExtra?: React.ReactNode;
}) {
  const hasMR = moons.some(
    (b) => b.facts.massKg != null && b.facts.radiusMeanKm != null,
  );
  const hasOrbit = moons.some((b) => hasUsableOrbit(b));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-zinc-200">
          Moons of {parent.name}
        </h3>
        {headerExtra}
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {hasMR ? (
          <MassRadiusChart
            bodies={moons}
            title={`Moons of ${parent.name}: mass vs radius (Earth units)`}
          />
        ) : null}
        {hasOrbit ? (
          <APeriodChart
            bodies={moons}
            title={`Moons of ${parent.name}: a vs orbital period`}
          />
        ) : null}
        <OrbitLadder parent={parent} moons={moons} />
      </div>
    </section>
  );
}

function earthRef(): Body | undefined {
  return getBody("earth");
}

/** Body-page focus layout — no system Planets dump; no sibling moon graphs. */
function BodyFocusCharts({
  focus,
  systemBodies,
  host,
}: {
  focus: Body;
  systemBodies: Body[];
  host: string;
}) {
  const planets = filterKinds(systemBodies, ["planet", "dwarf_planet"]);
  const asteroids = filterKinds(systemBodies, ["asteroid"]);
  const earth = earthRef();

  if (focus.kind === "star") {
    const sections: ChartSection[] = [];
    if (groupHasChartData(planets)) {
      sections.push({
        key: "planets",
        title: "Planets",
        subset: planets,
        distanceSubject: "host",
      });
    }
    if (groupHasChartData(asteroids)) {
      sections.push({
        key: "asteroids",
        title: "Asteroids",
        subset: asteroids,
        distanceSubject: "host",
      });
    }
    if (sections.length === 0) {
      return (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-sm text-zinc-500">
          No chartable bodies for this focus
        </div>
      );
    }
    return (
      <div className="space-y-8">
        {sections.map((section) => (
          <SectionCharts key={section.key} section={section} host={host} />
        ))}
      </div>
    );
  }

  if (focus.kind === "planet" || focus.kind === "dwarf_planet") {
    const moons = moonChildrenOf(focus.id, systemBodies);
    const vs = earth && earth.id !== focus.id ? earth : undefined;

    return (
      <div className="space-y-8">
        <div className="grid gap-4 lg:grid-cols-2">
          {vs ? <BodyDials body={focus} vs={vs} /> : null}
          {moons.length === 1 ? (
            <>
              <SizePair larger={focus} smaller={moons[0]} />
              <HowFarOut parent={focus} moon={moons[0]} />
            </>
          ) : null}
        </div>
        {moons.length >= 2 ? (
          <MoonsOfSection parent={focus} moons={moons} />
        ) : null}
        {moons.length === 0 && !vs ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-sm text-zinc-500">
            See Key facts above — no comparison set for this body
          </div>
        ) : null}
      </div>
    );
  }

  if (focus.kind === "moon") {
    const parent = focus.parentId ? getBody(focus.parentId) : undefined;
    const vs = parent ?? earth;
    return (
      <div className="space-y-8">
        <div className="grid gap-4 lg:grid-cols-2">
          {parent ? (
            <ParentContextCard moon={focus} parent={parent} />
          ) : null}
          {vs ? <BodyDials body={focus} vs={vs} /> : null}
          {parent &&
          focus.facts.radiusMeanKm != null &&
          parent.facts.radiusMeanKm != null ? (
            <SizePair larger={parent} smaller={focus} />
          ) : null}
        </div>
      </div>
    );
  }

  if (focus.kind === "asteroid") {
    const vs = earth;
    return (
      <div className="space-y-8">
        <div className="grid gap-4 lg:grid-cols-2">
          {vs ? <BodyDials body={focus} vs={vs} /> : null}
        </div>
        {!vs ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-sm text-zinc-500">
            See Key facts above
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-sm text-zinc-500">
      No chartable bodies for this focus
    </div>
  );
}

function DiscoverMoonSection({
  systemBodies,
}: {
  systemBodies: Body[];
}) {
  const options = useMemo(
    () => moonParentOptions(systemBodies),
    [systemBodies],
  );
  const defaultId = options[0]?.parent.id ?? "";
  const [moonParentId, setMoonParentId] = useState(defaultId);

  // Reset when system membership changes (new default parent).
  const selectedId = options.some((o) => o.parent.id === moonParentId)
    ? moonParentId
    : defaultId;

  if (options.length === 0) return null;

  const parent = getBody(selectedId);
  const moons = parent ? moonChildrenOf(parent.id, systemBodies) : [];

  if (!parent) return null;

  const headerExtra = (
    <MoonParentPicker
      options={options}
      selectedId={selectedId}
      onSelect={setMoonParentId}
    />
  );

  if (!groupHasChartData(moons) && moons.every((m) => orbitAKm(m) == null)) {
    return (
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-zinc-200">
            Moons of {parent.name}
          </h3>
          {headerExtra}
        </div>
        <p className="text-sm text-zinc-500">
          No chartable orbits for this parent&apos;s moons
        </p>
      </section>
    );
  }

  return (
    <MoonsOfSection parent={parent} moons={moons} headerExtra={headerExtra} />
  );
}

export function CatalogCharts({ systemId, focusId }: ChartsProps) {
  const bodies = useSystemBodies(systemId);
  const host = hostLabel(systemId);
  const focus = focusId ? getBody(focusId) : undefined;

  // Body page: kind-scoped focus layout (never system Planets dump on a planet).
  if (focus && focus.systemId === (systemId ?? getHomeSystem().id)) {
    return (
      <BodyFocusCharts focus={focus} systemBodies={bodies} host={host} />
    );
  }

  // Discover / system overview: Planets + Asteroids kind groups; Moons via parent picker.
  const planets = filterKinds(bodies, ["planet", "dwarf_planet"]);
  const asteroids = filterKinds(bodies, ["asteroid"]);
  const planetSection: ChartSection | null = groupHasChartData(planets)
    ? {
        key: "planets",
        title: "Planets",
        subset: planets,
        distanceSubject: "host",
      }
    : null;
  const asteroidSection: ChartSection | null = groupHasChartData(asteroids)
    ? {
        key: "asteroids",
        title: "Asteroids",
        subset: asteroids,
        distanceSubject: "host",
      }
    : null;

  const hasMultiMoonParents = moonParentOptions(bodies).length > 0;

  if (!planetSection && !asteroidSection && !hasMultiMoonParents) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-sm text-zinc-500">
        No chartable bodies in this system
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {planetSection ? (
        <SectionCharts section={planetSection} host={host} />
      ) : null}
      {hasMultiMoonParents ? (
        <DiscoverMoonSection systemBodies={bodies} />
      ) : null}
      {asteroidSection ? (
        <SectionCharts section={asteroidSection} host={host} />
      ) : null}
    </div>
  );
}
