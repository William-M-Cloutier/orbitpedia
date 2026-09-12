"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Body } from "@/data/schema";
import {
  formatJdYear,
  probeEarthDistanceSeries,
  type ProbeDistPoint,
} from "@/lib/probeDistance";

const tipStyle = {
  background: "#0c1220",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  fontSize: 12,
};

const SERIES_COLORS = [
  "#38bdf8",
  "#fbbf24",
  "#a78bfa",
  "#34d399",
  "#fb7185",
  "#f472b6",
  "#2dd4bf",
  "#e879f9",
  "#94a3b8",
];

function ChartShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <h3 className="mb-2 text-sm font-medium text-zinc-300">{title}</h3>
      <div className="relative h-52 w-full">{children}</div>
    </div>
  );
}

function formatDist(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v < 0.01) return v.toPrecision(2);
  if (v < 10) return v.toPrecision(3);
  return String(Math.round(v));
}

/** Single probe: distance from Earth (au) vs time — waypoints only. */
export function ProbeDistanceChart({ body }: { body: Body }) {
  const series = useMemo(() => probeEarthDistanceSeries(body), [body]);
  if (series.length < 2) return null;

  const data = series.map((p) => ({
    jd: p.jd,
    earthDistAu: p.earthDistAu,
    date: p.date,
  }));

  return (
    <ChartShell title={`Distance from Earth — ${body.name}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
        >
          <CartesianGrid stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="jd"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v: number) => formatJdYear(v)}
            stroke="#71717a"
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            tickCount={5}
          />
          <YAxis
            dataKey="earthDistAu"
            stroke="#71717a"
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            tickFormatter={formatDist}
            width={44}
            label={{
              value: "au",
              angle: -90,
              position: "insideLeft",
              fill: "#71717a",
              fontSize: 11,
            }}
          />
          <Tooltip
            contentStyle={tipStyle}
            labelFormatter={(v) => formatJdYear(Number(v))}
            formatter={(value) => [
              `${formatDist(Number(value))} au`,
              "From Earth",
            ]}
          />
          <Line
            type="monotone"
            dataKey="earthDistAu"
            name={body.name}
            stroke={body.color ?? SERIES_COLORS[0]}
            strokeWidth={2}
            dot={{ r: 3, fill: body.color ?? SERIES_COLORS[0] }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

type CompareRow = { jd: number; date?: string } & Record<string, number | string | undefined>;

/** Discover compare: multi-probe earthDistAu vs jd (union of sample times). */
export function ProbeDistanceCompareChart({ bodies }: { bodies: Body[] }) {
  const prepared = useMemo(() => {
    const series: { body: Body; points: ProbeDistPoint[]; key: string }[] = [];
    for (const b of bodies) {
      if (b.kind !== "probe") continue;
      const points = probeEarthDistanceSeries(b);
      if (points.length < 2) continue;
      series.push({ body: b, points, key: b.id });
    }
    if (series.length < 2) return null;

    const jdSet = new Set<number>();
    for (const s of series) {
      for (const p of s.points) jdSet.add(p.jd);
    }
    const jds = [...jdSet].sort((a, b) => a - b);
    const rows: CompareRow[] = jds.map((jd) => {
      const row: CompareRow = { jd };
      for (const s of series) {
        const hit = s.points.find((p) => p.jd === jd);
        if (hit) {
          row[s.key] = hit.earthDistAu;
          if (hit.date && !row.date) row.date = hit.date;
        }
      }
      return row;
    });
    return { series, rows };
  }, [bodies]);

  if (!prepared) return null;

  return (
    <ChartShell title="Distance from Earth (au)">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={prepared.rows}
          margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
        >
          <CartesianGrid stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="jd"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v: number) => formatJdYear(v)}
            stroke="#71717a"
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            tickCount={5}
          />
          <YAxis
            stroke="#71717a"
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            tickFormatter={formatDist}
            width={44}
            label={{
              value: "au",
              angle: -90,
              position: "insideLeft",
              fill: "#71717a",
              fontSize: 11,
            }}
          />
          <Tooltip
            contentStyle={tipStyle}
            labelFormatter={(v) => formatJdYear(Number(v))}
            formatter={(value, name) => [
              value == null ? "—" : `${formatDist(Number(value))} au`,
              String(name),
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }}
            iconType="line"
          />
          {prepared.series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.body.name}
              stroke={s.body.color ?? SERIES_COLORS[i % SERIES_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 2.5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
