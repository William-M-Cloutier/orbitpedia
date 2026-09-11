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

/** Scatter chrome: full-width plot. Titles clear ticks by sitting in the
 *  axis band (Y) / under the plot (X) — never by fat empty gutters.
 *  Recharts `position:"left"` is measured from the YAxis band’s LEFT edge
 *  (margin.left), not the plot; a large positive offset clips off-canvas,
 *  while a huge margin.left only adds dead space left of the band.
 *  Tick `unit` stays in titles so tick strings stay short. */
const SCATTER_MARGIN = { top: 12, right: 20, bottom: 40, left: 8 } as const;
/** Title strip + gap + short tick numbers inside the Y band. */
const SCATTER_Y_WIDTH = 52;

function scatterXLabel(value: string) {
  return {
    value,
    // Center under the plot/axis, not the whole card.
    position: "insideBottom" as const,
    offset: -2,
    fill: "#71717a",
    fontSize: 11,
  };
}

function scatterYLabel(value: string) {
  return {
    value,
    angle: -90,
    position: "left" as const,
    // Negative offset pulls the title INTO the Y band (left of ticks).
    // Band layout: [title | gap | ticks] within SCATTER_Y_WIDTH.
    // Closer to 0 = further left (away from tick numbers near the plot).
    offset: 0,
    fill: "#71717a",
    fontSize: 11,
  };
}

function ChartCard({
  title,
  children,
  /** Fixed plot height (scatters). Omit for auto-height (bar / custom). */
  heightClass = "h-44",
  autoHeight = false,
  /** Stretch plot to fill a grid cell (moons Size + mass–radius row). */
  fillHeight = false,
}: {
  title: string;
  children: React.ReactNode;
  heightClass?: string;
  autoHeight?: boolean;
  fillHeight?: boolean;
}) {
  return (
    <div
      className={
        fillHeight
          ? "flex h-full min-h-0 flex-col rounded-xl border border-white/10 bg-white/[0.03] p-3"
          : "rounded-xl border border-white/10 bg-white/[0.03] p-3"
      }
    >
      <h3 className="mb-2 shrink-0 text-sm font-medium text-zinc-300">{title}</h3>
      {autoHeight ? (
        <div className="w-full">{children}</div>
      ) : (
        <div
          className={
            fillHeight
              ? "min-h-[13rem] w-full flex-1"
              : `w-full ${heightClass}`
          }
        >
          {children}
        </div>
      )}
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
  fillHeight,
}: {
  bodies: Body[];
  title: string;
  focusId?: string;
  /** Fill grid-cell Y next to Size strip (moons-of section). */
  fillHeight?: boolean;
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
      <ChartCard title={title} fillHeight={fillHeight}>
        <p className="flex h-full items-center justify-center text-sm text-zinc-500">
          No mass+radius pairs in this group
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard title={title} heightClass="h-52" fillHeight={fillHeight}>
      <ResponsiveContainer>
        <ScatterChart margin={SCATTER_MARGIN}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" />
          <XAxis
            type="number"
            dataKey="massMe"
            name="Mass"
            scale="log"
            domain={["auto", "auto"]}
            stroke="#71717a"
            tick={{ fontSize: 11 }}
            tickMargin={6}
            tickFormatter={formatShortNumber}
            height={36}
            label={scatterXLabel("Mass (M⊕)")}
          />
          <YAxis
            type="number"
            dataKey="radiusRe"
            name="Radius"
            scale="log"
            domain={["auto", "auto"]}
            stroke="#71717a"
            tick={{ fontSize: 11 }}
            tickMargin={6}
            tickFormatter={formatShortNumber}
            width={SCATTER_Y_WIDTH}
            label={scatterYLabel("Radius (R⊕)")}
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
    <ChartCard title={title} heightClass="h-52">
      <ResponsiveContainer>
        <ScatterChart margin={SCATTER_MARGIN}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" />
          <XAxis
            type="number"
            dataKey="aAu"
            name="a"
            scale="log"
            domain={["auto", "auto"]}
            stroke="#71717a"
            tick={{ fontSize: 11 }}
            tickMargin={6}
            tickFormatter={formatShortNumber}
            height={36}
            label={scatterXLabel("a (AU)")}
          />
          <YAxis
            type="number"
            dataKey="periodYr"
            name="Period"
            scale="log"
            domain={["auto", "auto"]}
            stroke="#71717a"
            tick={{ fontSize: 11 }}
            tickMargin={6}
            tickFormatter={formatShortNumber}
            width={SCATTER_Y_WIDTH}
            label={scatterYLabel("Period (yr)")}
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
      <ChartCard title={title} autoHeight>
        <p className="py-6 text-center text-sm text-zinc-500">
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
  const plotH = horizontal
    ? Math.min(280, Math.max(120, n * 26 + 24))
    : Math.min(200, Math.max(140, 44 + n * 8));

  if (horizontal) {
    return (
      <ChartCard title={title} autoHeight>
        <div style={{ height: plotH }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={distanceData}
            margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
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
        </div>
      </ChartCard>
    );
  }

  return (
    <ChartCard title={title} autoHeight>
      <div style={{ height: plotH }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={distanceData}
          margin={{ top: 4, right: 8, bottom: 4, left: 4 }}
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
      </div>
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

  const dL = 88;
  // Keep the larger body fixed; scale the other by radius ratio.
  const sizeA = rL >= rS ? dL : Math.max(14, (rL / rS) * dL);
  const sizeB = rS >= rL ? dL : Math.max(14, (rS / rL) * dL);

  const mL = larger.facts.massKg;
  const mS = smaller.facts.massKg;
  const massCaption =
    mL != null && mS != null && mS > 0
      ? `Mass ratio ${larger.name} / ${smaller.name}: ${shortRatio(mL / mS)}×`
      : mL != null && mS != null && mL > 0
        ? `Mass ratio ${smaller.name} / ${larger.name}: ${shortRatio(mS / mL)}×`
        : null;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <h3 className="mb-2 text-sm font-medium text-zinc-300">Size pair</h3>
      <div className="flex items-end justify-center gap-6 py-2">
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
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <h3 className="mb-2 text-sm font-medium text-zinc-300">How far out</h3>
      <div className="relative mx-auto mt-1 h-12 max-w-md">
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

/** Multi-moon “How far out”: parent at origin, moons on a number-line by a. */
function HowFarOutMulti({
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
        fill: m.color ?? "#a1a1aa",
        radii,
        aKm,
        sort:
          radii ??
          (aKm != null
            ? aKm / (parent.facts.radiusMeanKm ?? 1)
            : null),
      };
    })
    .filter((r) => r.sort != null)
    .sort((a, b) => (a.sort as number) - (b.sort as number));

  if (rows.length === 0) return null;

  const useRadii = rows.every((r) => r.radii != null);
  const values = rows.map((r) =>
    useRadii ? (r.radii as number) : (r.aKm as number) / 1000,
  );
  const maxVal = Math.max(...values);
  const unitLabel = useRadii ? "parent radii" : "×10³ km";
  const unitShort = useRadii ? "R" : "k";

  // Bigger number-line. Parent at origin; moons placed by a / max(a).
  // N≥3 (or packed labels): wider inner SVG + horizontal scroll so scale stays readable.
  const n = rows.length;
  const fontSize = n >= 5 ? 12 : 13;
  const distFont = 11;
  const parentR = 20;
  const moonR = 8;
  const padL = 44;
  const padR = 32;
  const trackStartGap = 26; // parent disc clearance before track

  const labelHalfW = (name: string) => {
    const short = name.length > 9 ? `${name.slice(0, 8)}…` : name;
    return Math.max(18, short.length * fontSize * 0.34 + 8);
  };

  // Width budget for full-width row under Size + mass–radius: longer X,
  // gentle scroll cap (never a marathon scrub).
  const softMaxW = 960;
  const maxTrack = softMaxW - padL - trackStartGap - padR;

  // Min center-to-center gap between moon markers (moonR=8 → 16px disc).
  // Linear a/max(a) alone leaves Saturn’s inners bunched; hybrid layout below
  // guarantees this gap while still weighting leftover span by √(Δa) so
  // one huge outer step (Titan→Iapetus) doesn’t starve the inner pack.
  const minPairPx = 48;
  let trackW = Math.max(260, n * 90);
  if (n >= 3) {
    const needMin = (n - 1) * minPairPx;
    // Prefer a long horizontal number line on the full-width row; soft-capped.
    trackW = Math.max(
      trackW,
      Math.min(maxTrack, Math.round(needMin * 1.8)),
      Math.min(maxTrack, Math.round(maxTrack * 0.9)),
    );
  }
  trackW = Math.min(Math.max(trackW, n < 3 ? 260 : 300), maxTrack);

  const W = Math.round(padL + trackStartGap + trackW + padR);
  const trackX0 = padL + trackStartGap;
  const trackX1 = W - padR;
  // Scroll only for comparison-worthy packs (Saturn/Jupiter…); Mars (2) fits.
  const needsHScroll = n >= 3;

  // Hybrid x positions: order + approximate scale, readable min gaps.
  const xs: number[] = new Array(n);
  if (n === 1) {
    const t = maxVal > 0 ? values[0] / maxVal : 0;
    xs[0] = trackX0 + Math.min(1, Math.max(0, t)) * trackW;
  } else {
    const diffs = values.slice(1).map((v, i) => Math.max(0, v - values[i]));
    const sumDiff = diffs.reduce((a, b) => a + b, 0) || 1;
    const leftT = maxVal > 0 ? Math.min(1, Math.max(0, values[0] / maxVal)) : 0;
    const needMin = (n - 1) * minPairPx;
    // Span available for first→last after innermost inset.
    let gapBudget = Math.max(trackW * (1 - leftT), needMin);
    // If min gaps won’t fit past the inset, shrink inset so last stays on-track.
    let x0 = trackX0 + leftT * trackW;
    if (x0 + gapBudget > trackX1) {
      gapBudget = Math.max(needMin, trackX1 - trackX0);
      x0 = trackX1 - gapBudget;
      if (x0 < trackX0) {
        x0 = trackX0;
        gapBudget = trackX1 - trackX0;
      }
    }
    const gapScale = gapBudget < needMin ? gapBudget / needMin : 1;
    const extra = Math.max(0, gapBudget - needMin * gapScale);
    // √Δa weights: preserve order/scale feel without outer-pair monopoly.
    const weights = diffs.map((d) => Math.sqrt(d / sumDiff));
    const wSum = weights.reduce((a, b) => a + b, 0) || 1;
    const gaps = weights.map(
      (w) => minPairPx * gapScale + (extra * w) / wSum,
    );
    xs[0] = x0;
    for (let i = 1; i < n; i++) xs[i] = xs[i - 1] + gaps[i - 1];
  }

  // Collision-aware sides: prefer below; when x-close, alternate above/below
  // and fan to extra tiers so Saturn’s tight inner moons stay readable.
  type Slot = { side: 1 | -1; tier: number };
  const slots: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const occupied = new Set<string>();
    for (let j = 0; j < i; j++) {
      if (
        Math.abs(xs[i] - xs[j]) <
        labelHalfW(rows[i].name) + labelHalfW(rows[j].name)
      ) {
        occupied.add(`${slots[j].side}:${slots[j].tier}`);
      }
    }
    let chosen: Slot | null = null;
    for (let tier = 0; tier < n && !chosen; tier++) {
      // side +1 = below (prefer), -1 = above
      for (const side of [1, -1] as const) {
        if (!occupied.has(`${side}:${tier}`)) {
          chosen = { side, tier };
          break;
        }
      }
    }
    slots.push(chosen ?? { side: 1, tier: i });
  }
  const maxAbove = slots.reduce(
    (m, s) => (s.side === -1 ? Math.max(m, s.tier) : m),
    -1,
  );
  const maxBelow = slots.reduce(
    (m, s) => (s.side === 1 ? Math.max(m, s.tier) : m),
    -1,
  );
  // Marker→label gap; pairH covers name + distance stack (bigger type).
  const labelGap = 16;
  const pairH = 28;
  const topRoom =
    maxAbove >= 0 ? labelGap + (maxAbove + 1) * pairH + 4 : 20;
  const axisY = Math.max(parentR + 4, topRoom);
  const bottomRoom =
    maxBelow >= 0 ? labelGap + (maxBelow + 1) * pairH + 4 : 14;
  const H = axisY + bottomRoom;

  const svg = (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={needsHScroll ? W : undefined}
      height={needsHScroll ? H : undefined}
      className={
        needsHScroll
          ? "block h-auto max-w-none"
          : "mx-auto block h-auto w-full max-w-lg"
      }
      style={needsHScroll ? { minWidth: W } : undefined}
      role="img"
      aria-label={`${parent.name} moons by orbital distance`}
    >
      {/* track */}
      <line
        x1={trackX0 - 10}
        y1={axisY}
        x2={trackX1}
        y2={axisY}
        stroke="rgba(255,255,255,0.16)"
        strokeWidth={5}
        strokeLinecap="round"
      />
      {/* parent at origin */}
      <circle
        cx={padL}
        cy={axisY}
        r={parentR}
        fill={parent.color ?? "#888"}
      >
        <title>{parent.name}</title>
      </circle>
      {rows.map((r, i) => {
        const x = xs[i];
        const val = values[i];
        const { side, tier } = slots[i];
        const nameY = axisY + side * (labelGap + tier * pairH);
        const distY = nameY + side * 13;
        const tickEnd =
          axisY + side * Math.max(8, labelGap + tier * pairH - 4);
        const shortName =
          r.name.length > 9 ? `${r.name.slice(0, 8)}…` : r.name;
        return (
          <g key={r.id}>
            <line
              x1={x}
              y1={axisY}
              x2={x}
              y2={tickEnd}
              stroke="rgba(255,255,255,0.4)"
              strokeWidth={2}
            />
            <circle
              cx={x}
              cy={axisY}
              r={moonR}
              fill={r.fill}
              stroke="rgba(255,255,255,0.45)"
              strokeWidth={2}
            >
              <title>{`${r.name}: ${shortRatio(val)} ${unitLabel}`}</title>
            </circle>
            <a href={`/body/${r.id}`}>
              <text
                x={x}
                y={nameY}
                textAnchor="middle"
                dominantBaseline={side === 1 ? "hanging" : "auto"}
                fill="#e4e4e7"
                style={{ fontSize, fontWeight: 500 }}
              >
                {shortName}
              </text>
              <text
                x={x}
                y={distY}
                textAnchor="middle"
                dominantBaseline={side === 1 ? "hanging" : "auto"}
                fill="#a1a1aa"
                style={{
                  fontSize: distFont,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {shortRatio(val)} {unitShort}
              </text>
            </a>
          </g>
        );
      })}
    </svg>
  );

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <h3 className="mb-1 text-sm font-medium text-zinc-300">
        How far out
        <span className="ml-1.5 font-normal text-zinc-500">({unitLabel})</span>
      </h3>
      {needsHScroll ? (
        <div className="w-full overflow-x-auto overscroll-x-contain">
          {svg}
        </div>
      ) : (
        svg
      )}
      <p className="mt-1 text-center text-[11px] text-zinc-600">
        Sorted by semi-major axis · not system AU
        {needsHScroll ? " · swipe for scale" : ""}
      </p>
    </div>
  );
}

/** Compact size pair (planet vs one moon) for multi-pair rows. */
function SizePairCompact({
  parent,
  moon,
}: {
  parent: Body;
  moon: Body;
}) {
  const rP = parent.facts.radiusMeanKm;
  const rM = moon.facts.radiusMeanKm;
  if (rP == null || rM == null || rP <= 0 || rM <= 0) return null;

  const dP = 56;
  const dM = Math.max(10, (rM / rP) * dP);

  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg bg-white/[0.02] px-2 py-2">
      <div className="flex items-end gap-2">
        <div
          className="rounded-full"
          style={{
            width: dP,
            height: dP,
            background: parent.color ?? "#888",
          }}
          title={`${parent.name}: ${formatRadius(rP)}`}
        />
        <div
          className="rounded-full"
          style={{
            width: dM,
            height: dM,
            background: moon.color ?? "#a1a1aa",
          }}
          title={`${moon.name}: ${formatRadius(rM)}`}
        />
      </div>
      <div className="text-center text-[11px] leading-tight text-zinc-400">
        <span className="text-zinc-300">{parent.name}</span>
        <span className="mx-1 text-zinc-600">·</span>
        <Link
          href={`/body/${moon.id}`}
          className="text-sky-400/80 hover:text-sky-300"
        >
          {moon.name}
        </Link>
      </div>
      <div className="text-[10px] text-zinc-600">
        {shortRatio(rP / rM)}× radius
      </div>
    </div>
  );
}

/** Row of planet↔moon size pairs when N≤3. */
function SizePairsRow({
  parent,
  moons,
}: {
  parent: Body;
  moons: Body[];
}) {
  const sorted = [...moons].sort((a, b) => {
    const aa = orbitAKm(a) ?? Number.POSITIVE_INFINITY;
    const ba = orbitAKm(b) ?? Number.POSITIVE_INFINITY;
    return aa - ba;
  });
  const usable = sorted.filter(
    (m) =>
      m.facts.radiusMeanKm != null &&
      parent.facts.radiusMeanKm != null &&
      (m.facts.radiusMeanKm as number) > 0,
  );
  if (usable.length === 0) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <h3 className="mb-2 text-sm font-medium text-zinc-300">Size pairs</h3>
      <div className="flex flex-wrap justify-center gap-3">
        {usable.map((m) => (
          <SizePairCompact key={m.id} parent={parent} moon={m} />
        ))}
      </div>
      <p className="mt-1.5 text-center text-[11px] text-zinc-600">
        Discs scaled by mean radius (not mass)
      </p>
    </div>
  );
}

/** Single size strip: parent + moons as discs sorted by a (N≥4). */
function SizeStrip({
  parent,
  moons,
}: {
  parent: Body;
  moons: Body[];
}) {
  const rP = parent.facts.radiusMeanKm;
  if (rP == null || rP <= 0) return null;

  const sorted = [...moons]
    .filter(
      (m) =>
        m.facts.radiusMeanKm != null && (m.facts.radiusMeanKm as number) > 0,
    )
    .sort((a, b) => {
      const aa = orbitAKm(a) ?? Number.POSITIVE_INFINITY;
      const ba = orbitAKm(b) ?? Number.POSITIVE_INFINITY;
      return aa - ba;
    });
  if (sorted.length === 0) return null;

  const maxMoonR = Math.max(
    ...sorted.map((m) => m.facts.radiusMeanKm as number),
  );
  // Parent disc fixed; moons scale vs largest moon so tiny ones stay visible.
  const dP = 64;
  const dMoonMax = 36;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <h3 className="mb-2 text-sm font-medium text-zinc-300">
        Size strip
        <span className="ml-1.5 font-normal text-zinc-500">
          (sorted by orbit)
        </span>
      </h3>
      <div className="flex flex-wrap items-end justify-center gap-3 py-1">
        <div className="flex flex-col items-center gap-1">
          <div
            className="rounded-full shadow-[inset_0_-6px_16px_rgba(0,0,0,0.35)]"
            style={{
              width: dP,
              height: dP,
              background: parent.color ?? "#888",
            }}
            title={`${parent.name}: ${formatRadius(rP)}`}
          />
          <div className="max-w-[4.5rem] truncate text-center text-[11px] text-zinc-300">
            {parent.name}
          </div>
          <div className="text-[10px] text-zinc-600">{formatRadius(rP)}</div>
        </div>
        {sorted.map((m) => {
          const rM = m.facts.radiusMeanKm as number;
          const d = Math.max(8, (rM / maxMoonR) * dMoonMax);
          return (
            <div key={m.id} className="flex flex-col items-center gap-1">
              <div
                className="rounded-full shadow-[inset_0_-4px_10px_rgba(0,0,0,0.35)]"
                style={{
                  width: d,
                  height: d,
                  background: m.color ?? "#a1a1aa",
                }}
                title={`${m.name}: ${formatRadius(rM)}`}
              />
              <Link
                href={`/body/${m.id}`}
                className="max-w-[4.5rem] truncate text-center text-[11px] text-zinc-300 hover:text-sky-300"
              >
                {m.name}
              </Link>
              <div className="text-[10px] text-zinc-600">
                {formatRadius(rM)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-center text-[11px] text-zinc-600">
        Moon discs scaled to each other; {parent.name} shown at fixed size for
        context (not same scale)
      </p>
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
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
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
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <h3 className="mb-2 text-sm font-medium text-zinc-300">
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

/** Moon compare: size pairs/strip + multi How-far-out; mass–radius only if ≥3 points. */
function MoonsOfSection({
  parent,
  moons,
  headerExtra,
}: {
  parent: Body;
  moons: Body[];
  headerExtra?: React.ReactNode;
}) {
  const n = moons.length;
  const mrCount = moons.filter(
    (b) => b.facts.massKg != null && b.facts.radiusMeanKm != null,
  ).length;
  // Earns space only when enough moons to compare physically.
  const showMR = mrCount >= 3;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-zinc-200">
          Moons of {parent.name}
        </h3>
        {headerExtra}
      </div>
      {/* Top: Size + mass–radius; How far out full-width below (short + wide). */}
      <div
        className={
          showMR
            ? "grid gap-3 lg:grid-cols-2 lg:items-stretch"
            : "grid gap-3"
        }
      >
        {n <= 3 ? (
          <SizePairsRow parent={parent} moons={moons} />
        ) : (
          <SizeStrip parent={parent} moons={moons} />
        )}
        {showMR ? (
          <MassRadiusChart
            bodies={moons}
            title={`Moons of ${parent.name}: mass vs radius (Earth units)`}
            fillHeight
          />
        ) : null}
      </div>
      <HowFarOutMulti parent={parent} moons={moons} />
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
      <div className="space-y-6">
        <div className="grid gap-3 lg:grid-cols-2">
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
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-500">
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
      <div className="space-y-6">
        <div className="grid gap-3 lg:grid-cols-2">
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
