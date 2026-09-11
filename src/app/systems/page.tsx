"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/ui/AppShell";
import {
  getBodiesForSystem,
  getHomeSystem,
  listSystems,
} from "@/data/catalog";
import { hasUsableOrbit } from "@/data/schema";

/** Inter-system node spacing — Schematic / Proportional only (no True). */
type MapSpacing = "schematic" | "proportional";

const SPACING_MODES: { id: MapSpacing; label: string }[] = [
  { id: "schematic", label: "Schematic" },
  { id: "proportional", label: "Proportional" },
];

type SystemNode = {
  id: string;
  name: string;
  home: boolean;
  memberCount: number;
  planetCount: number;
  /** Outermost primary-frame semi-major axis (au); used for proportional spacing. */
  outerAAu: number;
  starColor: string;
};

function buildNodes(): SystemNode[] {
  return listSystems().map((s) => {
    const bodies = getBodiesForSystem(s.id);
    const star = bodies.find((b) => b.kind === "star");
    let outerAAu = 0;
    for (const b of bodies) {
      if (!hasUsableOrbit(b) || b.orbit?.frame === "parent") continue;
      if (b.orbit.aAu > outerAAu) outerAAu = b.orbit.aAu;
    }
    return {
      id: s.id,
      name: s.name,
      home: s.home === true,
      memberCount: bodies.length,
      planetCount: bodies.filter((b) => b.kind === "planet").length,
      outerAAu: outerAAu > 0 ? outerAAu : 1,
      starColor: star?.color ?? "#FDB813",
    };
  });
}

/**
 * Place systems on a horizontal layout.
 * Schematic: equal gaps. Proportional: gaps grow with outerAAu (not ly / True).
 */
function layoutNodes(
  nodes: SystemNode[],
  spacing: MapSpacing,
  width: number,
  height: number,
): Array<SystemNode & { x: number; y: number; r: number }> {
  if (nodes.length === 0) return [];
  const padX = 80;
  const usable = Math.max(120, width - padX * 2);
  const y = height * 0.48;

  if (spacing === "schematic" || nodes.length === 1) {
    const step = nodes.length > 1 ? usable / (nodes.length - 1) : 0;
    return nodes.map((n, i) => ({
      ...n,
      x: padX + (nodes.length === 1 ? usable / 2 : i * step),
      y,
      r: n.home ? 28 : 22,
    }));
  }

  // Proportional: cumulative outer-a spans (schematic floor so tiny systems stay clickable).
  const weights = nodes.map((n) => Math.max(0.15, Math.sqrt(n.outerAAu)));
  const sum = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return nodes.map((n, i) => {
    const w = weights[i]!;
    // Place at center of each weight segment.
    const x = padX + ((acc + w / 2) / sum) * usable;
    acc += w;
    return { ...n, x, y, r: n.home ? 28 : 20 + Math.min(10, Math.sqrt(n.outerAAu) * 2) };
  });
}

function SystemMapView() {
  const router = useRouter();
  const homeId = getHomeSystem().id;
  const [spacing, setSpacing] = useState<MapSpacing>("schematic");
  const nodes = useMemo(() => buildNodes(), []);
  // Fixed design size; SVG scales via viewBox.
  const W = 960;
  const H = 420;
  const laid = useMemo(
    () => layoutNodes(nodes, spacing, W, H),
    [nodes, spacing],
  );

  return (
    <AppShell>
      <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-[1600px] flex-col px-4 py-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-medium text-zinc-100">System map</h1>
            <p className="mt-0.5 max-w-2xl text-sm text-zinc-500">
              Systems as nodes — spacing is Schematic or Proportional only (not
              true inter-system distances). Click a system to open Explore.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-lg border border-white/10 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-300">
              <div className="mb-1.5 font-medium uppercase tracking-wide text-zinc-500">
                Spacing
              </div>
              <div className="flex gap-1">
                {SPACING_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSpacing(m.id)}
                    className={
                      spacing === m.id
                        ? "rounded-md bg-sky-600 px-2 py-1 font-medium text-white"
                        : "rounded-md bg-white/5 px-2 py-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                    }
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="rounded-md border border-sky-500/30 bg-sky-500/15 px-3 py-2 text-xs text-sky-200 hover:bg-sky-500/25"
            >
              Home (Solar)
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-[#060a14]">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-full w-full"
            role="img"
            aria-label="System map"
          >
            <defs>
              <radialGradient id="mapGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#1a2a4a" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#060a14" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width={W} height={H} fill="#060a14" />
            <ellipse
              cx={W / 2}
              cy={H / 2}
              rx={W * 0.42}
              ry={H * 0.38}
              fill="url(#mapGlow)"
            />

            {/* Baseline */}
            <line
              x1={60}
              y1={H * 0.48}
              x2={W - 60}
              y2={H * 0.48}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
              strokeDasharray="4 6"
            />

            {/* Connectors */}
            {laid.slice(0, -1).map((a, i) => {
              const b = laid[i + 1]!;
              return (
                <line
                  key={`e-${a.id}-${b.id}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="rgba(125,180,255,0.25)"
                  strokeWidth={1.5}
                />
              );
            })}

            {laid.map((n) => (
              <g
                key={n.id}
                className="cursor-pointer"
                onClick={() => {
                  const qs =
                    n.id === homeId
                      ? "/"
                      : `/?system=${encodeURIComponent(n.id)}`;
                  router.push(qs);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    const qs =
                      n.id === homeId
                        ? "/"
                        : `/?system=${encodeURIComponent(n.id)}`;
                    router.push(qs);
                  }
                }}
              >
                {/* Orbit rings hint */}
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r + 10}
                  fill="none"
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth={1}
                />
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r + 18}
                  fill="none"
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth={1}
                />
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r}
                  fill={n.starColor}
                  stroke={n.home ? "#7dd3fc" : "rgba(255,255,255,0.35)"}
                  strokeWidth={n.home ? 2.5 : 1.5}
                />
                <text
                  x={n.x}
                  y={n.y + n.r + 22}
                  textAnchor="middle"
                  className="fill-zinc-200"
                  style={{ fontSize: 13, fontWeight: 600 }}
                >
                  {n.name}
                </text>
                <text
                  x={n.x}
                  y={n.y + n.r + 38}
                  textAnchor="middle"
                  className="fill-zinc-500"
                  style={{ fontSize: 11 }}
                >
                  {n.planetCount} planet{n.planetCount === 1 ? "" : "s"}
                  {n.home ? " · home" : ""}
                </text>
              </g>
            ))}
          </svg>
        </div>

        <p className="mt-2 text-xs text-zinc-600">
          Proportional spacing uses each system&apos;s outermost catalog
          semi-major axis as a weight — educational layout only, not light-year
          realism.
        </p>
      </div>
    </AppShell>
  );
}

export default function SystemsPage() {
  return <SystemMapView />;
}
