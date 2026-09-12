"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  Suspense,
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
  isSkyMapExcludedSystemId,
} from "@/data/catalog";
import {
  getSystemGraphAsync,
  listSystemsAsync,
  listSystemsWithSmokeSync,
  type ArchiveSystemSummary,
} from "@/data/archiveCatalog";
import { hasUsableOrbit, type System } from "@/data/schema";
import { SystemFacts } from "@/components/ui/SystemFacts";
import {
  loadFavoriteSystemIds,
  saveFavoriteSystemIds,
} from "@/lib/favoriteSystems";
import {
  starColorForMapSegment,
  starColorFromSpectralType,
} from "@/lib/starColor";
import { systemHasGasGiant } from "@/lib/hasGas";
import {
  MIN_VISUAL_GAP,
  placeSystemSky,
  separateSkyNodes,
  SOL_GAL,
} from "@/lib/skyLayout";
import {
  MilkyWayBackdrop,
  type MwLook,
} from "@/components/map/MilkyWayBackdrop";

/** Inter-system spacing — sky direction from coords; Prop uses true distance. */
type MapSpacing = "schematic" | "proportional";

const SPACING_MODES: { id: MapSpacing; label: string }[] = [
  { id: "schematic", label: "Schematic" },
  { id: "proportional", label: "Proportional" },
];

const MW_LOOKS: { id: MwLook; label: string }[] = [
  { id: "realistic", label: "Realistic" },
  { id: "artistic", label: "Artistic" },
];

/** Viewport size in world units at zoom = 1. Layout is much larger. */
const WORLD_W = 960;
const WORLD_H = 560;
/** Low enough to reveal Sol's neighborhood on the full disk. */
const ZOOM_MIN = 0.008;
const ZOOM_MAX = 6;
const PAN_SPEED = 520;
const PAN_SHIFT = 2.6;
/** Undirected k-NN edges: propose K nearest, hard-cap degree. */
const KNN_K = 2;
const DEGREE_CAP = 3;
/** Neighbor target (world units) — ~10× the old fit-to-view cluster. */
const MIN_SEP = 168;
/** Soft cap for in-view labels (prefer labeling all visible; cull off-screen). */
const LABEL_CAP = 220;
/** Base disc — uniform for every system (favorites render slightly larger). */
const NODE_R = 10;
const NODE_R_FAV = 13;

/** Spectral filter groups — first Harvard letter; Other = missing/non-letter. */
type SpectralChip = "M" | "K" | "G" | "FA" | "Other";
const SPECTRAL_CHIPS: { id: SpectralChip; label: string }[] = [
  { id: "M", label: "M dwarf" },
  { id: "K", label: "K (orange dwarf)" },
  { id: "G", label: "G (Sun-like)" },
  { id: "FA", label: "F / A (hotter)" },
  { id: "Other", label: "Other / unknown" },
];

/** Exclusive planet-count bins (soft ranges). */
type PlanetBin = "1" | "2" | "3-4" | "5+";
const PLANET_CHIPS: { id: PlanetBin; label: string }[] = [
  { id: "1", label: "1 planet" },
  { id: "2", label: "2 planets" },
  { id: "3-4", label: "3–4" },
  { id: "5+", label: "5+" },
];

/** Exclusive star-count bins (sy_snum / starCount). */
type StarBin = "1" | "2" | "3+";
const STAR_CHIPS: { id: StarBin; label: string }[] = [
  { id: "1", label: "1 star" },
  { id: "2", label: "2 stars" },
  { id: "3+", label: "3+ stars" },
];

function spectralChipFromType(
  spectralType: string | undefined | null,
): SpectralChip {
  if (!spectralType) return "Other";
  const letter = spectralType.trim().charAt(0).toUpperCase();
  if (letter === "M") return "M";
  if (letter === "K") return "K";
  if (letter === "G") return "G";
  if (letter === "F" || letter === "A") return "FA";
  return "Other";
}

function planetBinForCount(count: number): PlanetBin | null {
  if (count === 1) return "1";
  if (count === 2) return "2";
  if (count === 3 || count === 4) return "3-4";
  if (count >= 5) return "5+";
  return null;
}

function starBinForCount(count: number): StarBin | null {
  if (count === 1) return "1";
  if (count === 2) return "2";
  if (count >= 3) return "3+";
  return null;
}

/** Equal-area pie wedge path (N wedges fill the NODE_R disc). */
function pieWedgePath(
  cx: number,
  cy: number,
  r: number,
  index: number,
  n: number,
): string {
  const a0 = (index / n) * Math.PI * 2 - Math.PI / 2;
  const a1 = ((index + 1) / n) * Math.PI * 2 - Math.PI / 2;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
}

function toggleInSet<T>(prev: Set<T>, id: T): Set<T> {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

type SystemNode = {
  id: string;
  name: string;
  home: boolean;
  memberCount: number;
  planetCount: number;
  starCount: number;
  outerAAu: number;
  /** Primary / solid-fill color (single-star nodes). */
  starColor: string;
  /** Equal pie wedges when starCount ≥ 2 (spectral colors; unknown → Other). */
  starColors: string[];
  hostSpectralType?: string;
  spectralChip: SpectralChip;
  /** true = known gas; false = known none; undefined = missing index flag */
  hasGas?: boolean;
  /** Primary host kind is black_hole. */
  hasBlackHole?: boolean;
  /** Index mid-dot overview (archive stubs before graph load). */
  blurb?: string;
  distanceLy?: number;
  raDeg?: number;
  decDeg?: number;
};

function buildNodesFromList(
  rows: Array<System | ArchiveSystemSummary>,
): SystemNode[] {
  return rows.map((s) => {
    const curated = getSystem(s.id);
    if (curated) {
      const bodies = getBodiesForSystem(curated.id);
      const stars = bodies.filter((b) => b.kind === "star");
      const primary =
        (curated.primaryStarId
          ? stars.find((b) => b.id === curated.primaryStarId)
          : undefined) ??
        stars.find((b) => !b.parentId) ??
        stars[0];
      let outerAAu = 0;
      for (const b of bodies) {
        if (!hasUsableOrbit(b) || b.orbit?.frame === "parent") continue;
        if (b.kind === "star") continue;
        if (b.orbit.aAu > outerAAu) outerAAu = b.orbit.aAu;
      }
      const hostSpectralType =
        curated.hostSpectralType ??
        ("hostSpectralType" in s ? s.hostSpectralType : undefined);
      // Prefer index/system hasGas when present; else derive (Sol Jupiter…).
      const fromRow =
        "hasGas" in s && typeof s.hasGas === "boolean" ? s.hasGas : undefined;
      const fromCurated =
        typeof curated.hasGas === "boolean" ? curated.hasGas : undefined;
      const hasGas =
        fromRow !== undefined
          ? fromRow
          : fromCurated !== undefined
            ? fromCurated
            : systemHasGasGiant(bodies);
      const hasBlackHole =
        primary?.kind === "black_hole" ||
        bodies.some((b) => b.kind === "black_hole" && !b.parentId);
      const starCount =
        curated.starCount ??
        ("starCount" in s && typeof s.starCount === "number"
          ? s.starCount
          : undefined) ??
        Math.max(stars.length, 1);
      const orderedStars = [
        ...(primary ? [primary] : []),
        ...stars.filter((b) => b.id !== primary?.id),
      ];
      const starColors =
        orderedStars.length > 0
          ? orderedStars.map(
              (b) => b.color ?? starColorForMapSegment(hostSpectralType),
            )
          : [starColorFromSpectralType(hostSpectralType)];
      while (starColors.length < starCount) {
        starColors.push(starColorForMapSegment(undefined));
      }
      return {
        id: curated.id,
        name: curated.name,
        home: curated.home === true,
        memberCount: bodies.length,
        planetCount:
          curated.planetCount ??
          bodies.filter((b) => b.kind === "planet").length,
        starCount,
        outerAAu: outerAAu > 0 ? outerAAu : 1,
        starColor: primary?.color ?? starColors[0] ?? "#FDB813",
        starColors: starColors.slice(0, Math.max(starCount, 1)),
        hostSpectralType,
        spectralChip: spectralChipFromType(hostSpectralType),
        hasGas,
        hasBlackHole,
        blurb: curated.blurb,
        distanceLy: curated.distanceLy,
        raDeg:
          "raDeg" in curated && typeof curated.raDeg === "number"
            ? curated.raDeg
            : undefined,
        decDeg:
          "decDeg" in curated && typeof curated.decDeg === "number"
            ? curated.decDeg
            : undefined,
      };
    }
    const planets = s.planetCount ?? 0;
    const hostSpectralType =
      "hostSpectralType" in s ? s.hostSpectralType : undefined;
    const hasGas =
      "hasGas" in s && typeof s.hasGas === "boolean" ? s.hasGas : undefined;
    const hasBlackHole =
      "hasBlackHole" in s && typeof s.hasBlackHole === "boolean"
        ? s.hasBlackHole
        : "hostKind" in s && s.hostKind === "black_hole"
          ? true
          : undefined;
    const starCount =
      "starCount" in s && typeof s.starCount === "number" && s.starCount > 0
        ? s.starCount
        : 1;
    const companionTypes =
      "companionSpectralTypes" in s && Array.isArray(s.companionSpectralTypes)
        ? s.companionSpectralTypes
        : [];
    const starColors = [starColorForMapSegment(hostSpectralType)];
    for (let i = 0; i < starCount - 1; i++) {
      starColors.push(starColorForMapSegment(companionTypes[i]));
    }
    const blurb =
      "blurb" in s && typeof s.blurb === "string" && s.blurb.trim()
        ? s.blurb.trim()
        : undefined;
    const distanceLy =
      "distanceLy" in s && typeof s.distanceLy === "number"
        ? s.distanceLy
        : undefined;
    const raDeg =
      "raDeg" in s && typeof s.raDeg === "number" ? s.raDeg : undefined;
    const decDeg =
      "decDeg" in s && typeof s.decDeg === "number" ? s.decDeg : undefined;
    return {
      id: s.id,
      name: s.name,
      home: false,
      memberCount: planets + starCount,
      planetCount: planets,
      starCount,
      outerAAu: 1,
      starColor: starColorFromSpectralType(hostSpectralType),
      starColors,
      hostSpectralType,
      spectralChip: spectralChipFromType(hostSpectralType),
      hasGas,
      hasBlackHole,
      blurb,
      distanceLy,
      raDeg,
      decDeg,
    };
  });
}



function layoutNodes(
  nodes: SystemNode[],
  spacing: MapSpacing,
): Array<SystemNode & { x: number; y: number; r: number; unknownSky: boolean }> {
  if (nodes.length === 0) return [];

  // Stable gutter order for missing coords (do not invent sky positions).
  const unknownOrder = new Map<string, number>();
  let gutter = 0;
  for (const n of nodes) {
    if (n.home) continue;
    const has =
      typeof n.raDeg === "number" &&
      Number.isFinite(n.raDeg) &&
      typeof n.decDeg === "number" &&
      Number.isFinite(n.decDeg);
    if (!has) {
      unknownOrder.set(n.id, gutter++);
    }
  }

  const pts = nodes.map((n) => {
    const placed = placeSystemSky(
      n,
      spacing,
      unknownOrder.get(n.id) ?? 0,
    );
    if (n.home) {
      return {
        ...n,
        x: SOL_GAL.x,
        y: SOL_GAL.y,
        r: NODE_R,
        unknownSky: false,
      };
    }
    return {
      ...n,
      x: placed.x,
      y: placed.y,
      r: NODE_R,
      unknownSky: placed.unknownSky,
    };
  });

  // Local clump + gutter only — distant hosts (galactic center, far archive)
  // stay at true sky positions. Same min gap for Schematic and Proportional.
  const local = pts.filter(
    (p) =>
      p.unknownSky ||
      p.home ||
      Math.hypot(p.x - SOL_GAL.x, p.y - SOL_GAL.y) < 2500,
  );
  separateSkyNodes(local, MIN_VISUAL_GAP, SOL_GAL.x, SOL_GAL.y);
  for (const p of pts) {
    if (p.home) {
      p.x = SOL_GAL.x;
      p.y = SOL_GAL.y;
    }
  }

  return pts;
}

type LaidPt = { id: string; x: number; y: number };

/**
 * Lean undirected neighbor graph — spatial-hash k-NN proposals, greedy degree
 * cap. Avoids O(n²) at ~1k; does not star every system from home/Sol.
 */
function buildNeighborEdges(
  pts: LaidPt[],
): Array<{ key: string; x1: number; y1: number; x2: number; y2: number }> {
  const n = pts.length;
  if (n < 2) return [];

  const cell = Math.max(MIN_SEP * 0.85, 48);
  const bins = new Map<string, number[]>();
  const cellKey = (x: number, y: number) =>
    `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const k = cellKey(p.x, p.y);
    const list = bins.get(k);
    if (list) list.push(i);
    else bins.set(k, [i]);
  }

  type Cand = { i: number; j: number; d: number };
  const candMap = new Map<string, Cand>();

  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const cx = Math.floor(a.x / cell);
    const cy = Math.floor(a.y / cell);
    const local: Cand[] = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const idxs = bins.get(`${cx + dx}:${cy + dy}`);
        if (!idxs) continue;
        for (const j of idxs) {
          if (j === i) continue;
          const b = pts[j]!;
          local.push({
            i: Math.min(i, j),
            j: Math.max(i, j),
            d: Math.hypot(b.x - a.x, b.y - a.y),
          });
        }
      }
    }
    local.sort((u, v) => u.d - v.d);
    let added = 0;
    const seenOther = new Set<number>();
    for (const c of local) {
      const other = c.i === i ? c.j : c.i;
      if (seenOther.has(other)) continue;
      seenOther.add(other);
      if (added >= KNN_K) break;
      const ek = `${c.i}:${c.j}`;
      const prev = candMap.get(ek);
      if (!prev || c.d < prev.d) candMap.set(ek, c);
      added++;
    }
  }

  const cands = [...candMap.values()].sort((a, b) => a.d - b.d);
  const degree = new Array<number>(n).fill(0);
  const out: Array<{
    key: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }> = [];
  for (const c of cands) {
    if (degree[c.i]! >= DEGREE_CAP || degree[c.j]! >= DEGREE_CAP) continue;
    const a = pts[c.i]!;
    const b = pts[c.j]!;
    degree[c.i]!++;
    degree[c.j]!++;
    out.push({
      key: `${a.id}|${b.id}`,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
    });
  }
  return out;
}

type Cam = { x: number; y: number; zoom: number };

/**
 * Default / Reset zoom frames Sol's schematic neighborhood (SCHEMATIC_R≈280
 * plus separation slack) so smoke archive hosts are on-screen — not a tight
 * Sol-only crop that makes ~97 systems look "missing". Full-disk zoom-out
 * stays cheap via ZOOM_MIN.
 */
const NEIGHBORHOOD_ZOOM = 0.42;
const CAM0: Cam = { x: SOL_GAL.x, y: SOL_GAL.y, zoom: NEIGHBORHOOD_ZOOM };

function viewBoxFor(cam: Cam): string {
  const w = WORLD_W / cam.zoom;
  const h = WORLD_H / cam.zoom;
  return `${cam.x - w / 2} ${cam.y - h / 2} ${w} ${h}`;
}

function SystemMapView() {
  const router = useRouter();
  const homeId = getHomeSystem().id;
  const [spacing, setSpacing] = useState<MapSpacing>("schematic");
  const [mwLook, setMwLook] = useState<MwLook>("realistic");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<SystemNode[]>(() =>
    buildNodesFromList(
      listSystemsWithSmokeSync().filter((s) => !isSkyMapExcludedSystemId(s.id)),
    ),
  );
  const [cam, setCam] = useState<Cam>(CAM0);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(
    () => new Set([homeId]),
  );
  const [favoritesHydrated, setFavoritesHydrated] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [spectralFilters, setSpectralFilters] = useState<Set<SpectralChip>>(
    () => new Set(),
  );
  const [planetFilters, setPlanetFilters] = useState<Set<PlanetBin>>(
    () => new Set(),
  );
  const [starFilters, setStarFilters] = useState<Set<StarBin>>(() => new Set());
  const [hasGasFilter, setHasGasFilter] = useState(false);
  const [blackHoleFilter, setBlackHoleFilter] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);

  const clearMapFilters = useCallback(() => {
    setSpectralFilters(new Set());
    setPlanetFilters(new Set());
    setStarFilters(new Set());
    setBlackHoleFilter(false);
    setHasGasFilter(false);
    setFavoritesOnly(false);
  }, []);

  const panelFiltersActive =
    spectralFilters.size > 0 ||
    planetFilters.size > 0 ||
    starFilters.size > 0 ||
    hasGasFilter ||
    blackHoleFilter;
  const panelFilterCount =
    spectralFilters.size +
    planetFilters.size +
    starFilters.size +
    (hasGasFilter ? 1 : 0) +
    (blackHoleFilter ? 1 : 0);
  const filtersActive =
    favoritesOnly ||
    spectralFilters.size > 0 ||
    planetFilters.size > 0 ||
    starFilters.size > 0 ||
    hasGasFilter ||
    blackHoleFilter;

  useEffect(() => {
    if (!filtersOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = filtersRef.current;
      if (el && !el.contains(e.target as Node)) setFiltersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFiltersOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen]);

  useEffect(() => {
    setFavoriteIds(loadFavoriteSystemIds(homeId));
    setFavoritesHydrated(true);
  }, [homeId]);

  useEffect(() => {
    if (!favoritesHydrated) return;
    saveFavoriteSystemIds(favoriteIds, homeId);
  }, [favoriteIds, favoritesHydrated, homeId]);

  const toggleFavorite = useCallback(
    (id: string) => {
      if (id === homeId) return;
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        next.add(homeId);
        return next;
      });
    },
    [homeId],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listSystemsAsync();
        if (cancelled) return;
        setNodes(
          buildNodesFromList(list.filter((s) => !isSkyMapExcludedSystemId(s.id))),
        );
      } catch {
        /* sync smoke seed already shown */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [selectedSystem, setSelectedSystem] = useState<System | null>(null);

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
        starCount: n.starCount,
        home: false,
        hostSpectralType: n.hostSpectralType,
        hasGas: n.hasGas,
        blurb: n.blurb,
        distanceLy: n.distanceLy,
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

  const mapNodes = useMemo(() => {
    return nodes.filter((n) => {
      if (favoritesOnly && !favoriteIds.has(n.id)) return false;
      // OR within spectral group; empty = all
      if (
        spectralFilters.size > 0 &&
        !spectralFilters.has(n.spectralChip)
      ) {
        return false;
      }
      // OR within planet bins (exclusive bins); empty = all
      if (planetFilters.size > 0) {
        const bin = planetBinForCount(n.planetCount);
        if (!bin || !planetFilters.has(bin)) return false;
      }
      // OR within star bins; empty = all. AND with other filter groups.
      if (starFilters.size > 0) {
        const bin = starBinForCount(n.starCount);
        if (!bin || !starFilters.has(bin)) return false;
      }
      // Has gas giant: off = don't care; on → hasGas === true (missing excluded).
      if (hasGasFilter && n.hasGas !== true) return false;
      if (blackHoleFilter && n.hasBlackHole !== true) return false;
      return true;
    });
  }, [
    nodes,
    favoritesOnly,
    favoriteIds,
    spectralFilters,
    planetFilters,
    starFilters,
    hasGasFilter,
    blackHoleFilter,
  ]);

  const laid = useMemo(
    () => layoutNodes(mapNodes, spacing),
    [mapNodes, spacing],
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
      systemId === homeId ? "/" : `/?system=${encodeURIComponent(systemId)}`,
    );
  }

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

  const knnEdges = useMemo(
    () => buildNeighborEdges(laid.map((n) => ({ id: n.id, x: n.x, y: n.y }))),
    [laid],
  );

  const { visible, labeledIds, visibleEdges } = useMemo(() => {
    const cullPad = 220;
    const viewW = WORLD_W / cam.zoom;
    const viewH = WORLD_H / cam.zoom;
    const vx0 = cam.x - viewW / 2 - cullPad;
    const vy0 = cam.y - viewH / 2 - cullPad;
    const vx1 = cam.x + viewW / 2 + cullPad;
    const vy1 = cam.y + viewH / 2 + cullPad;
    const inBox = (x: number, y: number, r = 0) =>
      x + r >= vx0 && x - r <= vx1 && y + r >= vy0 && y - r <= vy1;
    const visible = laid.filter((n) => inBox(n.x, n.y, n.r));
    // Prefer labeling every in-view system; soft-cap only if needed for perf.
    const ids = new Set<string>();
    if (selectedId) ids.add(selectedId);
    if (hoveredId) ids.add(hoveredId);
    const scored = visible
      .map((n) => ({
        id: n.id,
        d: Math.hypot(n.x - cam.x, n.y - cam.y),
      }))
      .sort((a, b) => a.d - b.d);
    for (const s of scored) {
      if (ids.size >= LABEL_CAP) break;
      ids.add(s.id);
    }
    const visibleEdges = knnEdges.filter(
      (e) => inBox(e.x1, e.y1) || inBox(e.x2, e.y2),
    );
    return { visible, labeledIds: ids, visibleEdges };
  }, [laid, knnEdges, cam.x, cam.y, cam.zoom, selectedId, hoveredId]);

  const onMapKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && selectedId) {
      e.preventDefault();
      openExplore(selectedId);
    }
    if (e.key === "Escape") {
      setSelectedId(null);
    }
  };

  const resetView = () => {
    const n = homeLaid;
    const next = n
      ? { x: n.x, y: n.y, zoom: NEIGHBORHOOD_ZOOM }
      : CAM0;
    camRef.current = next;
    applyViewBox(next);
    setCam(next);
    setSelectedId(null);
  };

  return (
    <AppShell>
      <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-[1600px] flex-col px-4 py-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-medium text-zinc-100">System map</h1>
            <p className="mt-0.5 max-w-xl text-sm text-zinc-500">
              Sky map of catalog systems on the Milky Way. Drag or WASD (Shift
              faster); scroll to zoom out across the disk.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            <div className="rounded-lg border border-white/10 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-300">
              <div className="mb-1.5 font-medium uppercase tracking-wide text-zinc-500">
                Milky Way
              </div>
              <div className="flex gap-1">
                {MW_LOOKS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMwLook(m.id)}
                    className={
                      mwLook === m.id
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
              onClick={resetView}
              className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300 hover:bg-white/10"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="rounded-md border border-sky-500/30 bg-sky-500/15 px-3 py-2 text-xs text-sky-200 hover:bg-sky-500/25"
            >
              Home
            </button>
            <div ref={filtersRef} className="relative">
              <button
                type="button"
                onClick={() => setFiltersOpen((o) => !o)}
                aria-expanded={filtersOpen}
                aria-haspopup="dialog"
                className={
                  panelFiltersActive || filtersOpen
                    ? "rounded-md border border-sky-500/40 bg-sky-500/15 px-3 py-2 text-xs font-medium text-sky-100"
                    : "rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300 hover:bg-white/10"
                }
              >
                Filters
                {panelFilterCount > 0 ? (
                  <span className="ml-1.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-sky-500/90 px-1 text-[10px] font-semibold text-white">
                    {panelFilterCount}
                  </span>
                ) : null}
              </button>
              {filtersOpen ? (
                <div
                  role="dialog"
                  aria-label="Map filters"
                  className="absolute right-0 z-30 mt-1.5 w-[min(100vw-2rem,18rem)] rounded-lg border border-white/10 bg-zinc-950/95 p-3 shadow-xl backdrop-blur"
                >
                  <div className="mb-3">
                    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                      Sun type
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {SPECTRAL_CHIPS.map((c) => {
                        const on = spectralFilters.has(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            aria-pressed={on}
                            title={
                              c.id === "Other"
                                ? "Unknown, missing, or non Harvard-letter spectral types"
                                : undefined
                            }
                            onClick={() =>
                              setSpectralFilters((prev) =>
                                toggleInSet(prev, c.id),
                              )
                            }
                            className={
                              on
                                ? "rounded-md bg-sky-600 px-2 py-1 text-[11px] font-medium text-white"
                                : "rounded-md bg-white/5 px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                            }
                          >
                            {c.label}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        aria-pressed={blackHoleFilter}
                        title="Systems with a black hole host"
                        onClick={() => setBlackHoleFilter((v) => !v)}
                        className={
                          blackHoleFilter
                            ? "rounded-md bg-sky-600 px-2 py-1 text-[11px] font-medium text-white"
                            : "rounded-md bg-white/5 px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                        }
                      >
                        Black hole
                      </button>
                    </div>
                  </div>
                  <div className="mb-3">
                    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                      Planets
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {PLANET_CHIPS.map((c) => {
                        const on = planetFilters.has(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              setPlanetFilters((prev) =>
                                toggleInSet(prev, c.id),
                              )
                            }
                            className={
                              on
                                ? "rounded-md bg-sky-600 px-2 py-1 text-[11px] font-medium text-white"
                                : "rounded-md bg-white/5 px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                            }
                          >
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mb-3">
                    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                      Stars
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {STAR_CHIPS.map((c) => {
                        const on = starFilters.has(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              setStarFilters((prev) => toggleInSet(prev, c.id))
                            }
                            className={
                              on
                                ? "rounded-md bg-sky-600 px-2 py-1 text-[11px] font-medium text-white"
                                : "rounded-md bg-white/5 px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                            }
                          >
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mb-3">
                    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                      Composition
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        aria-pressed={hasGasFilter}
                        title="At least one gas giant"
                        onClick={() => setHasGasFilter((v) => !v)}
                        className={
                          hasGasFilter
                            ? "rounded-md bg-sky-600 px-2 py-1 text-[11px] font-medium text-white"
                            : "rounded-md bg-white/5 px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                        }
                      >
                        Has gas giant
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-2">
                    <span className="text-[11px] tabular-nums text-zinc-500">
                      {mapNodes.length}
                      {mapNodes.length !== nodes.length
                        ? ` / ${nodes.length}`
                        : ""}{" "}
                      systems
                    </span>
                    {filtersActive ? (
                      <button
                        type="button"
                        onClick={clearMapFilters}
                        className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                      >
                        Clear
                      </button>
                    ) : (
                      <span className="text-[10px] text-zinc-600">
                        Empty = all
                      </span>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setFavoritesOnly((v) => !v)}
              aria-pressed={favoritesOnly}
              className={
                favoritesOnly
                  ? "rounded-md border border-amber-400/40 bg-amber-500/20 px-3 py-2 text-xs font-medium text-amber-100"
                  : "rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300 hover:bg-white/10"
              }
            >
              ★ Fav
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
          {mapNodes.length === 0 ? (
            <div className="pointer-events-auto absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#060a14]/92 px-6 text-center">
              <p className="text-sm text-zinc-300">No systems match</p>
              <p className="max-w-sm text-xs text-zinc-500">
                Nothing matches the current filters.
              </p>
              <button
                type="button"
                onClick={clearMapFilters}
                className="rounded-full border border-sky-500/30 bg-sky-500/15 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-500/25"
              >
                Clear filters
              </button>
            </div>
          ) : null}
          <svg
            ref={svgRef}
            viewBox={viewBoxFor(cam)}
            className="h-full w-full cursor-grab active:cursor-grabbing"
            role="img"
            aria-label="System map canvas"
            onClick={() => setSelectedId(null)}
          >
            <MilkyWayBackdrop look={mwLook} />

            {visibleEdges.map((e) => (
              <line
                key={e.key}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                stroke="rgba(125,180,255,0.2)"
                strokeWidth={1}
              />
            ))}

            {visible.map((n) => {
              const sel = n.id === selectedId;
              const fav = favoriteIds.has(n.id);
              const labeled = labeledIds.has(n.id);
              const drawR = fav ? NODE_R_FAV : NODE_R;
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
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={drawR + (fav ? 10 : 8)}
                    fill="none"
                    stroke={
                      fav ? "rgba(251,191,36,0.35)" : "rgba(255,255,255,0.14)"
                    }
                    strokeWidth={fav ? 1.5 : 1}
                  />
                  {sel ? (
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={drawR + 15}
                      fill="none"
                      stroke="rgba(56,189,248,0.28)"
                      strokeWidth={1.25}
                    />
                  ) : null}
                  {n.starCount >= 2 && n.starColors.length >= 2 ? (
                    <>
                      {n.starColors.slice(0, n.starCount).map((fill, i, arr) => (
                        <path
                          key={`${n.id}-wedge-${i}`}
                          d={pieWedgePath(n.x, n.y, drawR, i, arr.length)}
                          fill={fill}
                          stroke="none"
                        />
                      ))}
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={drawR}
                        fill="none"
                        stroke={
                          sel
                            ? "#38bdf8"
                            : fav
                              ? "#fbbf24"
                              : "rgba(186,230,253,0.7)"
                        }
                        strokeWidth={sel ? 2.5 : fav ? 2.25 : 1.5}
                      />
                    </>
                  ) : (
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={drawR}
                      fill={n.starColor}
                      stroke={
                        sel
                          ? "#38bdf8"
                          : fav
                            ? "#fbbf24"
                            : "rgba(186,230,253,0.7)"
                      }
                      strokeWidth={sel ? 2.5 : fav ? 2.25 : 1.5}
                    />
                  )}
                  {labeled ? (
                    <>
                      <text
                        x={n.x}
                        y={n.y + drawR + 14}
                        textAnchor="middle"
                        className={fav ? "fill-amber-200" : "fill-zinc-200"}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {n.name}
                      </text>
                      <text
                        x={n.x}
                        y={n.y + drawR + 26}
                        textAnchor="middle"
                        className={fav ? "fill-amber-500/80" : "fill-zinc-500"}
                        style={{ fontSize: 9 }}
                      >
                        {n.planetCount} planet
                        {n.planetCount === 1 ? "" : "s"}
                        {n.home ? " · home" : ""}
                        {fav && !n.home ? " · ★" : ""}
                      </text>
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
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggleFavorite(selectedSystem.id)}
                    disabled={selectedSystem.id === homeId}
                    aria-pressed={
                      selectedSystem.id === homeId ||
                      favoriteIds.has(selectedSystem.id)
                    }
                    aria-label={
                      selectedSystem.id === homeId
                        ? "Home stays favorited"
                        : favoriteIds.has(selectedSystem.id)
                          ? "Remove from favorites"
                          : "Add to favorites"
                    }
                    title={
                      selectedSystem.id === homeId
                        ? "Home stays favorited"
                        : favoriteIds.has(selectedSystem.id)
                          ? "Unfavorite"
                          : "Favorite"
                    }
                    className={
                      selectedSystem.id === homeId
                        ? "cursor-default rounded px-1.5 py-0.5 text-sm text-amber-300 opacity-90"
                        : favoriteIds.has(selectedSystem.id)
                          ? "rounded px-1.5 py-0.5 text-sm text-amber-300 hover:bg-amber-500/15"
                          : "rounded px-1.5 py-0.5 text-sm text-zinc-500 hover:bg-white/10 hover:text-amber-200"
                    }
                  >
                    {selectedSystem.id === homeId ||
                    favoriteIds.has(selectedSystem.id)
                      ? "★"
                      : "☆"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-white/10 hover:text-zinc-300"
                    aria-label="Close system facts"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <SystemFacts
                  system={selectedSystem}
                  bodies={getBodiesForSystem(selectedSystem.id)}
                  compact
                />
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
            {mapNodes.length}
            {mapNodes.length !== nodes.length ? ` / ${nodes.length}` : ""}{" "}
            systems · {visible.length} in view · {favoriteIds.size} ★
          </p>
        </div>

        <p className="mt-2 text-xs text-zinc-600">
          Drag or WASD to pan · Shift faster · scroll to zoom · Reset recenters
          on Sol · Enter opens the selected system
        </p>
      </div>
    </AppShell>
  );
}

export default function SystemsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center text-sm text-zinc-500">
          Loading systems…
        </div>
      }
    >
      <SystemMapView />
    </Suspense>
  );
}
