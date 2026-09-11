"use client";

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
import { bodies, hasUsableOrbit } from "@/data/catalog";
import { periodFromA } from "@/lib/kepler";
import { EARTH_MASS_KG, EARTH_RADIUS_KM } from "@/lib/units";

const orbiters = bodies.filter((b) => hasUsableOrbit(b));

const massRadiusData = bodies
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
  }));

const aPeriodData = orbiters.map((b) => {
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

const distanceData = orbiters
  .map((b) => ({
    name: b.name,
    aAu: b.orbit!.aAu,
    fill: b.color ?? "#888",
  }))
  .sort((a, b) => a.aAu - b.aAu);

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

export function MassRadiusChart() {
  return (
    <ChartCard title="Mass vs radius (Earth units)">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
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
            label={{ value: "Mass (M⊕)", position: "insideBottom", offset: -2, fill: "#71717a", fontSize: 11 }}
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
            width={48}
          />
          <ZAxis range={[60, 60]} />
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

export function APeriodChart() {
  return (
    <ChartCard title="Semi-major axis vs orbital period">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
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
            width={48}
          />
          <ZAxis range={[60, 60]} />
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

export function DistanceBarChart() {
  return (
    <ChartCard title="Distance from Sun (semi-major axis)">
      <ResponsiveContainer>
        <BarChart
          data={distanceData}
          margin={{ top: 8, right: 8, bottom: 24, left: 8 }}
        >
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="name"
            stroke="#71717a"
            tick={{ fontSize: 10 }}
            interval={0}
            angle={-35}
            textAnchor="end"
            height={48}
          />
          <YAxis
            stroke="#71717a"
            tick={{ fontSize: 11 }}
            width={40}
            unit=" AU"
          />
          <Tooltip contentStyle={tipStyle} />
          <Bar dataKey="aAu" name="a (AU)" radius={[4, 4, 0, 0]}>
            {distanceData.map((d) => (
              <Cell key={d.name} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function CatalogCharts() {
  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <MassRadiusChart />
      <APeriodChart />
      <DistanceBarChart />
    </div>
  );
}
