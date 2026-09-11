"use client";

import { useMemo } from "react";
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
  getHomeSystem,
  getSystem,
  hasUsableOrbit,
} from "@/data/catalog";
import { periodFromA } from "@/lib/kepler";
import { EARTH_MASS_KG, EARTH_RADIUS_KM } from "@/lib/units";

const tipStyle = {
  background: "#0c1220",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  fontSize: 12,
};

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
  const star = members.find((b) => b.kind === "star" && !b.parentId)
    ?? members.find((b) => b.kind === "star");
  if (star) return star.name;
  return sys?.name ?? "host";
}

export function MassRadiusChart({ systemId }: ChartsProps) {
  const bodies = useSystemBodies(systemId);
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
      <ChartCard title="Mass vs radius (Earth units)">
        <p className="flex h-full items-center justify-center text-sm text-zinc-500">
          No mass+radius pairs in this system
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Mass vs radius (Earth units)">
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
              typeof v === "number" ? v.toPrecision(3) : String(v),
              String(name),
            ]}
            labelFormatter={(_, payload) =>
              payload?.[0]?.payload?.name ?? ""
            }
          />
          <Scatter data={massRadiusData} fill="#38bdf8">
            {massRadiusData.map((d) => (
              <Cell key={d.id} fill={d.fill} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function APeriodChart({ systemId }: ChartsProps) {
  const bodies = useSystemBodies(systemId);
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
      <ChartCard title="Semi-major axis vs orbital period">
        <p className="flex h-full items-center justify-center text-sm text-zinc-500">
          No orbits in this system
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Semi-major axis vs orbital period">
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
              typeof v === "number" ? v.toPrecision(3) : String(v),
              String(name),
            ]}
            labelFormatter={(_, payload) =>
              payload?.[0]?.payload?.name ?? ""
            }
          />
          <Scatter data={aPeriodData}>
            {aPeriodData.map((d) => (
              <Cell key={d.id} fill={d.fill} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function DistanceBarChart({ systemId }: ChartsProps) {
  const bodies = useSystemBodies(systemId);
  const host = hostLabel(systemId);
  const distanceData = useMemo(() => {
    const orbiters = bodies.filter((b) => hasUsableOrbit(b));
    return orbiters
      .map((b) => ({
        id: b.id,
        // Short tick label: last segment of id or truncated name
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
      <ChartCard title={`Distance from ${host} (semi-major axis)`}>
        <p className="flex h-full items-center justify-center text-sm text-zinc-500">
          No orbits in this system
        </p>
      </ChartCard>
    );
  }

  const n = distanceData.length;
  const angle = n > 8 ? -40 : n > 5 ? -30 : 0;
  const bottom = angle === 0 ? 8 : 36;

  return (
    <ChartCard title={`Distance from ${host} (semi-major axis)`}>
      <ResponsiveContainer>
        <BarChart
          data={distanceData}
          margin={{ top: 8, right: 8, bottom, left: 8 }}
        >
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="#71717a"
            tick={{ fontSize: n > 10 ? 9 : 11 }}
            interval={0}
            angle={angle}
            textAnchor={angle === 0 ? "middle" : "end"}
            height={angle === 0 ? 28 : 52}
          />
          <YAxis
            stroke="#71717a"
            tick={{ fontSize: 11 }}
            width={48}
            unit=" AU"
          />
          <Tooltip
            contentStyle={tipStyle}
            labelFormatter={(_, payload) =>
              payload?.[0]?.payload?.name ?? ""
            }
            formatter={(v) => [
              typeof v === "number" ? `${v.toPrecision(4)} AU` : String(v),
              "a",
            ]}
          />
          <Bar dataKey="aAu" name="a (AU)" radius={[4, 4, 0, 0]}>
            {distanceData.map((d) => (
              <Cell key={d.id} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function CatalogCharts({ systemId }: ChartsProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <MassRadiusChart systemId={systemId} />
      <APeriodChart systemId={systemId} />
      <DistanceBarChart systemId={systemId} />
    </div>
  );
}
