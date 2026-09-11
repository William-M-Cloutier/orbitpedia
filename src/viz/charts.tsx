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
import { EARTH_MASS_KG, EARTH_RADIUS_KM } from "@/lib/units";

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

/** Parents with ≥1 moon in this system, sorted by child count desc. */
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

/** Body-page sections: always scoped by focus kind — never mix frames. */
function buildBodySections(
  focus: Body,
  systemBodies: Body[],
): ChartSection[] {
  const planets = filterKinds(systemBodies, ["planet", "dwarf_planet"]);
  const asteroids = filterKinds(systemBodies, ["asteroid"]);
  const sections: ChartSection[] = [];

  if (focus.kind === "star") {
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
    return sections;
  }

  if (focus.kind === "planet" || focus.kind === "dwarf_planet") {
    if (groupHasChartData(planets)) {
      sections.push({
        key: "planets",
        title: "Planets",
        subset: planets,
        distanceSubject: "host",
        focusId: focus.id,
      });
    }
    const moons = moonChildrenOf(focus.id, systemBodies);
    if (groupHasChartData(moons)) {
      sections.push({
        key: `moons-${focus.id}`,
        title: `Moons of ${focus.name}`,
        subset: moons,
        distanceSubject: "parent",
        parentName: focus.name,
      });
    }
    return sections;
  }

  if (focus.kind === "moon") {
    const parent = focus.parentId ? getBody(focus.parentId) : undefined;
    const siblings = parent
      ? moonChildrenOf(parent.id, systemBodies)
      : [focus];
    const parentName = parent?.name ?? "parent";
    if (groupHasChartData(siblings)) {
      sections.push({
        key: `moons-${parent?.id ?? focus.id}`,
        title: `Moons of ${parentName}`,
        subset: siblings,
        distanceSubject: "parent",
        parentName,
        focusId: focus.id,
        headerExtra: parent ? (
          <Link
            href={`/body/${parent.id}`}
            className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
          >
            Parent: {parent.name} →
          </Link>
        ) : undefined,
      });
    }
    return sections;
  }

  if (focus.kind === "asteroid") {
    if (groupHasChartData(asteroids)) {
      sections.push({
        key: "asteroids",
        title: "Asteroids",
        subset: asteroids,
        distanceSubject: "host",
        focusId: focus.id,
      });
    }
    return sections;
  }

  return sections;
}

function DiscoverMoonSection({
  systemBodies,
  host,
}: {
  systemBodies: Body[];
  host: string;
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
  const section: ChartSection = {
    key: `moons-${selectedId}`,
    title: parent ? `Moons of ${parent.name}` : "Moons",
    subset: moons,
    distanceSubject: "parent",
    parentName: parent?.name,
    headerExtra: (
      <MoonParentPicker
        options={options}
        selectedId={selectedId}
        onSelect={setMoonParentId}
      />
    ),
  };

  if (!groupHasChartData(moons)) {
    // Parent chips still shown — avoid permanent dead empty-state for moons.
    return (
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-zinc-200">
            {section.title}
          </h3>
          {section.headerExtra}
        </div>
        <p className="text-sm text-zinc-500">
          No chartable orbits for this parent&apos;s moons
        </p>
      </section>
    );
  }

  return <SectionCharts section={section} host={host} />;
}

export function CatalogCharts({ systemId, focusId }: ChartsProps) {
  const bodies = useSystemBodies(systemId);
  const host = hostLabel(systemId);
  const focus = focusId ? getBody(focusId) : undefined;

  // Body page: kind-scoped sections for the focused body.
  if (focus && focus.systemId === (systemId ?? getHomeSystem().id)) {
    const sections = buildBodySections(focus, bodies);
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

  const hasMoons = bodies.some((b) => b.kind === "moon");

  if (!planetSection && !asteroidSection && !hasMoons) {
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
      {hasMoons ? (
        <DiscoverMoonSection systemBodies={bodies} host={host} />
      ) : null}
      {asteroidSection ? (
        <SectionCharts section={asteroidSection} host={host} />
      ) : null}
    </div>
  );
}
