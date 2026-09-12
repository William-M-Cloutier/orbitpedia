"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/ui/AppShell";
import {
  getBodiesForSystem,
  getHomeSystem,
  getSystem,
  isFixtureSystemId,
  listSystems,
} from "@/data/catalog";
import {
  getSystemGraphAsync,
  listArchiveSystems,
  type ArchiveSystemSummary,
} from "@/data/archiveCatalog";
import { hasUsableOrbit } from "@/data/schema";
import { SystemFacts } from "@/components/ui/SystemFacts";

/** Inter-system node spacing — Schematic / Proportional only (no True). */
type MapSpacing = "schematic" | "proportional";
/** Soft density filter — All still LOD'd heavily. */
type MapFilter = "curated" | "multi" | "all";

const SPACING_MODES: { id: MapSpacing; label: string }[] = [
  { id: "schematic", label: "Schematic" },
  { id: "proportional", label: "Proportional" },
];

const FILTER_MODES: { id: MapFilter; label: string }[] = [
  { id: "curated", label: "Curated" },
  { id: "multi", label: "Multi-planet" },
  { id: "all", label: "All" },
];

const WORLD_W = 960;
const WORLD_H = 560;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 4;
const PAN_SPEED = 380;
const PAN_SHIFT = 2.6;
/** Skip pairwise separation above this count (use coarse grid instead). */
const SEPARATE_N_MAX = 80;
/** Cap spoke lines from home (curated always; archive limited). */
const SPOKE_CAP = 24;

type SystemNode = {
  id: string;
  name: string;
  home: boolean;
  curated: boolean;
  memberCount: number;
  planetCount: number;
  outerAAu: number;
  starColor: string;
};

function buildCuratedNodes(): SystemNode[] {
  return listSystems()
    .filter((s) => !isFixtureSystemId(s.id))
    .map((s) => {
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
        curated: true,
        memberCount: bodies.length,
        planetCount: bodies.filter((b) => b.kind === "planet").length,
        outerAAu: outerAAu > 0 ? outerAAu : 1,
        starColor: star?.color ?? "#FDB813",
      };
    });
}

/** Archive index stubs — graph fetched only when Explore opens the system. */
function buildArchiveStubNodes(
  rows: ArchiveSystemSummary[],
  curatedIds: Set<string>,
): SystemNode[] {
  return rows
    .filter((s) => !curatedIds.has(s.id) && !isFixtureSystemId(s.id))
    .map((s) => {
      const planets = s.planetCount ?? 0;
      return {
        id: s.id,
        name: s.name,
        home: false,
        curated: false,
        memberCount: planets + 1,
        planetCount: planets,
        outerAAu: 1,
        starColor: "#FDB813",
      };
    });
}

function nodeFootprint(r: number): number {
  return r + 44;
}

function radiusFor(n: SystemNode, spacing: MapSpacing): number {
  if (spacing === "schematic") return n.home ? 28 : n.curated ? 22 : 10;
  if (n.home) return 28;
  if (n.curated) return 20 + Math.min(10, Math.sqrt(n.outerAAu) * 2);
  return 8 + Math.min(4, Math.sqrt(n.planetCount));
}

/** Coarse grid placement — O(n) — used when N is large. */
function gridSeparate(
  pts: Array<{ x: number; y: number; r: number }>,
  cell: number,
): void {
  const bins = new Map<string, number[]>();
  const key = (x: number, y: number) =>
    `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const k = key(p.x, p.y);
    const list = bins.get(k);
    if (list) list.push(i);
    else bins.set(k, [i]);
  }
  for (const idxs of bins.values()) {
    if (idxs.length < 2) continue;
    // Local push within cell only
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        const pa = pts[idxs[a]!]!;
        const pb = pts[idxs[b]!]!;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const need = pa.r + pb.r + 6;
        if (dist >= need) continue;
        const push = (need - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        pa.x -= ux * push;
        pa.y -= uy * push;
        pb.x += ux * push;
        pb.y += uy * push;
      }
    }
  }
}

/** Push overlapping discs apart (includes label footprint on Y) — O(n²), small N. */
function separateNodes(
  pts: Array<{ x: number; y: number; r: number }>,
  pad: number,
  iters = 48,
): void {
  for (let iter = 0; iter < iters; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]!;
        const b = pts[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const need = a.r + b.r + pad + 36;
        if (dist >= need) continue;
        const push = (need - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function layoutNodes(
  nodes: SystemNode[],
  spacing: MapSpacing,
  width: number,
  height: number,
): Array<SystemNode & { x: number; y: number; r: number }> {
  if (nodes.length === 0) return [];
  const padX = 90;
  const padY = 70;
  const usableW = Math.max(120, width - padX * 2);
  const usableH = Math.max(120, height - padY * 2);
  const midY = height * 0.42;
  const cx0 = width / 2;

  const sorted = [...nodes].sort((a, b) => {
    if (a.home !== b.home) return a.home ? -1 : 1;
    if (a.curated !== b.curated) return a.curated ? -1 : 1;
    return b.outerAAu - a.outerAAu;
  });
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const nOther = Math.max(sorted.length - 1, 1);
  const maxExtent = Math.max(
    ...sorted.map((n) => Math.sqrt(n.outerAAu)),
    1,
  );

  const pts = sorted.map((n, i) => {
    const r = radiusFor(n, spacing);
    if (n.home || sorted.length === 1) {
      return { ...n, x: cx0, y: midY, r };
    }
    const k = i;
    const ang = k * GOLDEN;
    const ring = 0.28 + 0.72 * Math.sqrt(k / nOther);
    const distMul =
      spacing === "proportional"
        ? 0.62 + 0.58 * (Math.sqrt(n.outerAAu) / maxExtent)
        : 1;
    const rad = ring * distMul;
    return {
      ...n,
      x: cx0 + Math.cos(ang) * usableW * 0.42 * rad,
      y: midY + Math.sin(ang) * usableH * 0.42 * rad,
      r,
    };
  });

  if (pts.length <= SEPARATE_N_MAX) {
    separateNodes(pts, spacing === "schematic" ? 14 : 16);
  } else {
    gridSeparate(pts, spacing === "schematic" ? 28 : 24);
  }

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x - p.r);
    maxX = Math.max(maxX, p.x + p.r);
    minY = Math.min(minY, p.y - p.r);
    maxY = Math.max(maxY, p.y + nodeFootprint(p.r));
  }
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min(usableW / spanX, usableH / spanY, 1.15);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return pts.map((p) => ({
    ...p,
    x: width / 2 + (p.x - cx) * scale,
    y: height / 2 + (p.y - cy) * scale * 0.92,
  }));
}

type Cam = { x: number; y: number; zoom: number };

function viewBoxFor(cam: Cam): string {
  const w = WORLD_W / cam.zoom;
  const h = WORLD_H / cam.zoom;
  return `${cam.x - w / 2} ${cam.y - h / 2} ${w} ${h}`;
}

function SystemMapView() {
  const router = useRouter();
  const homeId = getHomeSystem().id;
  const [spacing, setSpacing] = useState<MapSpacing>("schematic");
  const [filter, setFilter] = useState<MapFilter>("curated");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [allNodes, setAllNodes] = useState<SystemNode[]>(() =>
    buildCuratedNodes(),
  );
  const [cam, setCam] = useState<Cam>({
    x: WORLD_W / 2,
    y: WORLD_H / 2,
    zoom: 1,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const curated = buildCuratedNodes();
      const curatedIds = new Set(curated.map((n) => n.id));
      try {
        const archive = await listArchiveSystems();
        if (cancelled) return;
        setAllNodes([
          ...curated,
          ...buildArchiveStubNodes(archive, curatedIds),
        ]);
      } catch {
        if (cancelled) return;
        setAllNodes(curated);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const nodes = useMemo(() => {
    if (filter === "curated") return allNodes.filter((n) => n.curated);
    if (filter === "multi")
      return allNodes.filter((n) => n.curated || n.planetCount >= 2);
    return allNodes;
  }, [allNodes, filter]);

  const [selectedSystem, setSelectedSystem] = useState<
    import("@/data/schema").System | null
  >(null);

  useEffect(() => {
    if (!selectedId) {
      setSelectedSystem(null);
      return;
    }
    const curated = getSystem(selectedId);
    if (curated) {
      setSelectedSystem(curated);
      return;
    }
    const n = nodes.find((x) => x.id === selectedId);
    if (n) {
      setSelectedSystem({
        id: n.id,
        name: n.name,
        memberIds: [],
        planetCount: n.planetCount,
        home: false,
        blurb: "Archive system (sparse). Open Explore to load the full graph.",
      });
    } else {
      setSelectedSystem(null);
    }
    let cancelled = false;
    getSystemGraphAsync(selectedId)
      .then((g) => {
        if (!cancelled) setSelectedSystem(g.system);
      })
      .catch(() => {
        /* stub panel already shown */
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, nodes]);

  const laid = useMemo(
    () => layoutNodes(nodes, spacing, WORLD_W, WORLD_H),
    [nodes, spacing],
  );

  const mapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const draggingRef = useRef(false);
  const lastPtrRef = useRef<{ x: number; y: number } | null>(null);
  const camRef = useRef(cam);
  camRef.current = cam;
  const keysActiveRef = useRef(false);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyViewBox = useCallback((c: Cam) => {
    const svg = svgRef.current;
    if (svg) svg.setAttribute("viewBox", viewBoxFor(c));
  }, []);

  const commitCam = useCallback(() => {
    setCam({ ...camRef.current });
  }, []);

  const scheduleCommit = useCallback(() => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      commitCam();
    }, 120);
  }, [commitCam]);

  function openExplore(systemId: string) {
    router.push(
      systemId === homeId
        ? "/"
        : `/?system=${encodeURIComponent(systemId)}`,
    );
  }

  // When selection changes, center that system (bias left of facts panel).
  useEffect(() => {
    if (!selectedId) return;
    const n = laid.find((x) => x.id === selectedId);
    if (!n) return;
    const prev = camRef.current;
    const w = WORLD_W / prev.zoom;
    const biasX = w * 0.14;
    const next = { ...prev, x: n.x + biasX, y: n.y };
    camRef.current = next;
    applyViewBox(next);
    setCam(next);
  }, [selectedId, laid, applyViewBox]);

  // WASD pan — mutate viewBox via ref; commit React cam when keys idle.
  useEffect(() => {
    const isEditable = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t.isContentEditable
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (
        k === "w" ||
        k === "a" ||
        k === "s" ||
        k === "d" ||
        k === "Shift"
      ) {
        keysRef.current.add(k === "Shift" ? "shift" : k);
        keysActiveRef.current = true;
        if (k === "w" || k === "a" || k === "s" || k === "d") e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === "Shift") keysRef.current.delete("shift");
      else keysRef.current.delete(k);
      const still =
        keysRef.current.has("w") ||
        keysRef.current.has("a") ||
        keysRef.current.has("s") ||
        keysRef.current.has("d");
      if (!still && keysActiveRef.current) {
        keysActiveRef.current = false;
        scheduleCommit();
      }
    };
    const onBlur = () => {
      keysRef.current.clear();
      if (keysActiveRef.current) {
        keysActiveRef.current = false;
        scheduleCommit();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const keys = keysRef.current;
      if (keys.size === 0) return;
      let dx = 0;
      let dy = 0;
      if (keys.has("a")) dx -= 1;
      if (keys.has("d")) dx += 1;
      if (keys.has("w")) dy -= 1;
      if (keys.has("s")) dy += 1;
      if (dx === 0 && dy === 0) return;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const c = camRef.current;
      const speed =
        (PAN_SPEED / c.zoom) * (keys.has("shift") ? PAN_SHIFT : 1);
      const next = {
        ...c,
        x: c.x + dx * speed * dt,
        y: c.y + dy * speed * dt,
      };
      camRef.current = next;
      applyViewBox(next);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    };
  }, [applyViewBox, scheduleCommit]);

  const onWheelFixed = (e: ReactWheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const el = mapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / Math.max(rect.width, 1);
    const ny = (e.clientY - rect.top) / Math.max(rect.height, 1);
    const prev = camRef.current;
    const nextZoom = Math.min(
      ZOOM_MAX,
      Math.max(ZOOM_MIN, prev.zoom * factor),
    );
    if (nextZoom === prev.zoom) return;
    const w0 = WORLD_W / prev.zoom;
    const h0 = WORLD_H / prev.zoom;
    const pivotX = prev.x - w0 / 2 + nx * w0;
    const pivotY = prev.y - h0 / 2 + ny * h0;
    const w1 = WORLD_W / nextZoom;
    const h1 = WORLD_H / nextZoom;
    const next = {
      zoom: nextZoom,
      x: pivotX - nx * w1 + w1 / 2,
      y: pivotY - ny * h1 + h1 / 2,
    };
    camRef.current = next;
    applyViewBox(next);
    scheduleCommit();
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    draggingRef.current = true;
    lastPtrRef.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!draggingRef.current || !lastPtrRef.current) return;
    const el = mapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dxPx = e.clientX - lastPtrRef.current.x;
    const dyPx = e.clientY - lastPtrRef.current.y;
    lastPtrRef.current = { x: e.clientX, y: e.clientY };
    const c = camRef.current;
    const w = WORLD_W / c.zoom;
    const h = WORLD_H / c.zoom;
    const dx = (-dxPx / Math.max(rect.width, 1)) * w;
    const dy = (-dyPx / Math.max(rect.height, 1)) * h;
    const next = { ...c, x: c.x + dx, y: c.y + dy };
    camRef.current = next;
    applyViewBox(next);
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    if (draggingRef.current) commitCam();
    draggingRef.current = false;
    lastPtrRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const homeLaid = laid.find((n) => n.home) ?? laid[0];

  // Spoke targets: curated always; archive capped when filter is dense.
  const spokeTargets = useMemo(() => {
    if (!homeLaid) return [];
    const others = laid.filter((n) => n.id !== homeLaid.id);
    if (filter === "curated") return others;
    const curatedOthers = others.filter((n) => n.curated);
    const archiveOthers = others.filter((n) => !n.curated);
    return [
      ...curatedOthers,
      ...archiveOthers.slice(0, Math.max(0, SPOKE_CAP - curatedOthers.length)),
    ];
  }, [laid, homeLaid, filter]);

  // Nearest node to camera center for optional label (when zoomed in).
  const nearestId = useMemo(() => {
    if (laid.length === 0) return null;
    if (cam.zoom < 1.35 && filter !== "curated") return null;
    let best: string | null = null;
    let bestD = Infinity;
    for (const n of laid) {
      const d = Math.hypot(n.x - cam.x, n.y - cam.y);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  }, [laid, cam.x, cam.y, cam.zoom, filter]);

  const showLabel = (n: SystemNode) =>
    n.curated ||
    n.id === selectedId ||
    n.id === hoveredId ||
    n.id === nearestId ||
    n.home;

  // Map-level keyboard: Enter opens selected / focused via selection.
  const onMapKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && selectedId) {
      e.preventDefault();
      openExplore(selectedId);
    }
    if (e.key === "Escape") {
      setSelectedId(null);
    }
  };

  // Viewport cull pad (world units)
  const cullPad = 80;
  const viewW = WORLD_W / cam.zoom;
  const viewH = WORLD_H / cam.zoom;
  const vx0 = cam.x - viewW / 2 - cullPad;
  const vy0 = cam.y - viewH / 2 - cullPad;
  const vx1 = cam.x + viewW / 2 + cullPad;
  const vy1 = cam.y + viewH / 2 + cullPad;
  const inView = (n: { x: number; y: number; r: number }) =>
    n.x + n.r >= vx0 &&
    n.x - n.r <= vx1 &&
    n.y + n.r >= vy0 &&
    n.y - n.r <= vy1;

  const visible = filter === "curated" ? laid : laid.filter(inView);

  return (
    <AppShell>
      <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-[1600px] flex-col px-4 py-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-medium text-zinc-100">System map</h1>
            <p className="mt-0.5 max-w-2xl text-sm text-zinc-500">
              Click a system for facts (centers view). Labels stay lean at large
              N — curated, selected, hover, or nearest when zoomed. Drag or WASD
              to pan, Shift faster, scroll to zoom. Double-click or Open Explore
              to enter.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-lg border border-white/10 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-300">
              <div className="mb-1.5 font-medium uppercase tracking-wide text-zinc-500">
                Show
              </div>
              <div className="flex gap-1">
                {FILTER_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setFilter(m.id);
                      setSelectedId(null);
                    }}
                    className={
                      filter === m.id
                        ? "rounded-md bg-violet-600 px-2 py-1 font-medium text-white"
                        : "rounded-md bg-white/5 px-2 py-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                    }
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
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
              onClick={() => {
                const next = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1 };
                camRef.current = next;
                applyViewBox(next);
                setCam(next);
                setSelectedId(null);
              }}
              className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300 hover:bg-white/10"
            >
              Reset view
            </button>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="rounded-md border border-sky-500/30 bg-sky-500/15 px-3 py-2 text-xs text-sky-200 hover:bg-sky-500/25"
            >
              Home (Solar)
            </button>
          </div>
        </div>

        <div
          ref={mapRef}
          className="relative min-h-0 flex-1 touch-none overflow-hidden rounded-xl border border-white/10 bg-[#060a14]"
          onWheel={onWheelFixed}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onMapKeyDown}
          tabIndex={0}
          role="application"
          aria-label="System map"
        >
          <svg
            ref={svgRef}
            viewBox={viewBoxFor(cam)}
            className="h-full w-full cursor-grab active:cursor-grabbing"
            role="img"
            aria-label="System map canvas"
            onClick={() => setSelectedId(null)}
          >
            <defs>
              <radialGradient id="mapGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#1a2a4a" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#060a14" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect
              x={-WORLD_W}
              y={-WORLD_H}
              width={WORLD_W * 3}
              height={WORLD_H * 3}
              fill="#060a14"
            />
            <ellipse
              cx={WORLD_W / 2}
              cy={WORLD_H / 2}
              rx={WORLD_W * 0.42}
              ry={WORLD_H * 0.38}
              fill="url(#mapGlow)"
            />

            {homeLaid
              ? spokeTargets.map((n) => (
                  <line
                    key={`e-${homeLaid.id}-${n.id}`}
                    x1={homeLaid.x}
                    y1={homeLaid.y}
                    x2={n.x}
                    y2={n.y}
                    stroke="rgba(125,180,255,0.22)"
                    strokeWidth={1}
                  />
                ))
              : null}

            {visible.map((n) => {
              const sel = n.id === selectedId;
              const showRings = n.home || n.curated || sel;
              const labeled = showLabel(n);
              return (
                <g
                  key={n.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedId(n.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    openExplore(n.id);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerEnter={() => setHoveredId(n.id)}
                  onPointerLeave={() =>
                    setHoveredId((h) => (h === n.id ? null : h))
                  }
                >
                  {showRings ? (
                    <>
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={n.r + 10}
                        fill="none"
                        stroke="rgba(255,255,255,0.12)"
                        strokeWidth={1}
                      />
                      {n.home || sel ? (
                        <circle
                          cx={n.x}
                          cy={n.y}
                          r={n.r + 18}
                          fill="none"
                          stroke="rgba(255,255,255,0.06)"
                          strokeWidth={1}
                        />
                      ) : null}
                    </>
                  ) : null}
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.r}
                    fill={n.starColor}
                    stroke={
                      sel
                        ? "#38bdf8"
                        : n.home
                          ? "#7dd3fc"
                          : "rgba(255,255,255,0.35)"
                    }
                    strokeWidth={sel ? 3 : n.home ? 2.5 : 1.25}
                  />
                  {labeled ? (
                    <>
                      <text
                        x={n.x}
                        y={n.y + n.r + 16}
                        textAnchor="middle"
                        className="fill-zinc-200"
                        style={{
                          fontSize: n.curated || sel ? 12 : 10,
                          fontWeight: 600,
                        }}
                      >
                        {n.name}
                      </text>
                      {(n.curated || sel) && (
                        <text
                          x={n.x}
                          y={n.y + n.r + 30}
                          textAnchor="middle"
                          className="fill-zinc-500"
                          style={{ fontSize: 10 }}
                        >
                          {n.planetCount} planet
                          {n.planetCount === 1 ? "" : "s"}
                          {n.home ? " · home" : ""}
                        </text>
                      )}
                    </>
                  ) : null}
                </g>
              );
            })}
          </svg>

          {selectedSystem ? (
            <aside
              className="pointer-events-auto absolute bottom-3 right-3 top-3 z-10 flex w-[min(100%-1.5rem,20rem)] flex-col overflow-hidden rounded-lg border border-sky-500/25 bg-[#080d18]/95 p-3 shadow-xl backdrop-blur"
              aria-label={`${selectedSystem.name} system facts`}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  System facts
                </p>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-white/10 hover:text-zinc-300"
                  aria-label="Close system facts"
                >
                  Close
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <SystemFacts system={selectedSystem} compact />
              </div>
              <button
                type="button"
                onClick={() => openExplore(selectedSystem.id)}
                className="mt-3 shrink-0 rounded-md border border-sky-500/30 bg-sky-500/15 px-2.5 py-1.5 text-xs text-sky-200 hover:bg-sky-500/25"
              >
                Open in Explore
              </button>
            </aside>
          ) : null}

          <p className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-zinc-600">
            {nodes.length} systems · filter {filter}
            {filter !== "curated" ? ` · ${visible.length} in view` : ""}
          </p>
        </div>

        <p className="mt-2 text-xs text-zinc-600">
          Drag or WASD to pan · Shift faster · scroll wheel zoom · Reset view
          restores the full map. Click empty space to dismiss facts. Enter opens
          selected system.
        </p>
      </div>
    </AppShell>
  );
}

export default function SystemsPage() {
  return <SystemMapView />;
}
