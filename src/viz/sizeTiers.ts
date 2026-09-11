import type { Body, BodyKind } from "@/data/schema";
import { getBody, getHomeSystemGraph } from "@/data/catalog";

/**
 * Visual mesh radii (render layer). Orbit paths stay in real AU so the
 * current Explore zoom bounds (min~0.5, max~80) remain the working box.
 *
 * - schematic: readable size tiers (default)
 * - proportional: true radius ratios; sun largest, capped so Mercury clears
 *   on real-AU orbits
 * - true: real radius ratios to the sun; sun sized to Mercury clearance on
 *   real-AU orbits (planets stay tiny vs sun — honest, still fits zoom)
 *
 * Never explode orbit distances to match a magnified sun — that shrinks the
 * whole system under the same camera. Clearance = cap the sun, keep AU paths.
 *
 * Adding a planet later = body-card facts only; this module maps radius → mesh.
 * Scoped to the home system graph for now (additive systems later).
 */

export type SizeMode = "schematic" | "proportional" | "true";

export const SIZE_MODES: { id: SizeMode; label: string }[] = [
  { id: "schematic", label: "Schematic" },
  { id: "proportional", label: "Proportional" },
  { id: "true", label: "True" },
];

export const DEFAULT_SIZE_MODE: SizeMode = "schematic";

/** Small rocky-planet schematic radius (Mercury / Venus / Earth / Mars). */
export const PLANET_VISUAL_RADIUS_SMALL = 0.1;

/** Gas-giant schematic radius. */
export const PLANET_VISUAL_RADIUS_LARGE = 0.18;

/**
 * Extra perihelion gap (AU) between sun surface and body surface.
 */
export const PERIHELION_CLEARANCE_MARGIN_AU = 0.04;

/**
 * Schematic sun radius in scene AU.
 * Mercury perihelion q≈0.307 AU; with planet 0.1 + margin 0.04 → max sun ≈0.167.
 */
export const STAR_VISUAL_RADIUS = 0.12;

const AU_KM = 149_597_870.7;

/** Mercury perihelion (AU) — used for proportional/true sun clearance. */
const MERCURY_Q_AU = 0.307;

export function minClearanceAu(
  bodyRadius: number = PLANET_VISUAL_RADIUS_SMALL,
): number {
  return STAR_VISUAL_RADIUS + bodyRadius + PERIHELION_CLEARANCE_MARGIN_AU;
}

function schematicRadius(body: Body): number {
  const tiers: Record<BodyKind, number> = {
    star: STAR_VISUAL_RADIUS,
    planet: (body.facts.radiusMeanKm ?? 0) > 20000
      ? PLANET_VISUAL_RADIUS_LARGE
      : PLANET_VISUAL_RADIUS_SMALL,
    dwarf_planet: 0.07,
    asteroid: 0.05,
    moon: 0.04,
  };
  return tiers[body.kind];
}

/** Max non-star radius (km) in the home system — for proportional fit. */
function maxNonStarRadiusKm(): number {
  let max = 0;
  for (const b of getHomeSystemGraph().bodies) {
    if (b.kind === "star") continue;
    const r = b.facts.radiusMeanKm;
    if (r != null && r > max) max = r;
  }
  return max > 0 ? max : 69_911; // Jupiter fallback
}

function mercuryRadiusKm(): number {
  const m = getBody("mercury");
  return m?.facts.radiusMeanKm ?? 2_439.7;
}

function sunRadiusKm(): number {
  const sun =
    getBody("sun") ??
    getHomeSystemGraph().bodies.find((b) => b.kind === "star");
  return sun?.facts.radiusMeanKm ?? 695_700;
}

/**
 * Proportional: sun is the biggest mesh; other bodies keep true radius ratios
 * and are scaled so the sun still clears Mercury's perihelion on real AU.
 */
function proportionalRadius(body: Body): number {
  const mercKm = mercuryRadiusKm();
  const maxKm = maxNonStarRadiusKm();
  // Solve: sun = S, maxPlanet = 0.92*S, mercMesh = maxPlanet * (mercKm/maxKm)
  // S + mercMesh + margin <= Mercury q
  const ratioMercToMax = mercKm / maxKm;
  const denom = 1 + 0.92 * ratioMercToMax;
  const sunMesh = (MERCURY_Q_AU - PERIHELION_CLEARANCE_MARGIN_AU) / denom;
  const scale = (0.92 * sunMesh) / maxKm; // km → scene AU

  if (body.kind === "star") {
    return sunMesh; // largest by construction
  }
  const km = body.facts.radiusMeanKm ?? 1;
  return Math.max(0.008, km * scale);
}

/**
 * True ratios on real-AU orbits: sunMesh * (1 + R_merc/R_sun) + margin <= q.
 * Planets stay tiny vs the sun (honest) and the system fits the zoom box.
 */
function trueRadius(body: Body): number {
  const sunKm = sunRadiusKm();
  const mercKm = mercuryRadiusKm();
  const denom = 1 + mercKm / sunKm;
  const sunMesh = (MERCURY_Q_AU - PERIHELION_CLEARANCE_MARGIN_AU) / denom;
  const scale = sunMesh / sunKm; // km → scene AU
  const km = body.facts.radiusMeanKm ?? 1;
  return Math.max(1e-6, km * scale);
}

/** Visual mesh radius in scene units (≈ AU for orbit layout). */
export function visualRadius(
  body: Body,
  mode: SizeMode = DEFAULT_SIZE_MODE,
): number {
  if (mode === "proportional") return proportionalRadius(body);
  if (mode === "true") return trueRadius(body);
  return schematicRadius(body);
}

/** True radius in AU (catalog), for tools/tests — not mesh size. */
export function physicalRadiusAu(body: Body): number {
  return (body.facts.radiusMeanKm ?? 0) / AU_KM;
}

/**
 * Orbit distance scale. Always 1: Explore zoom is the bounding box.
 * Clearance comes from capping sun meshes, not from exploding AU paths.
 */
export function orbitDistanceScale(_mode: SizeMode = DEFAULT_SIZE_MODE): number {
  return 1;
}

/**
 * Viz-only multiplier for one parent-frame child orbit (e.g. Moon).
 * Catalog a/e/i stay real; schematic/oversized parent meshes otherwise swallow
 * the child path. Scales relative Kepler XYZ so periapsis clears
 * parentVis + childVis + a small margin (never written back to Store B).
 *
 * When a parent has multiple moons, prefer {@link parentFrameSharedDisplayScale}
 * so siblings share one inflate factor (per-child scales can stack everyone on
 * the same display periapsis and intersect).
 */
export function parentFrameDisplayScale(
  childOrbitQAu: number,
  parentVis: number,
  childVis: number,
): number {
  const margin = Math.min(PERIHELION_CLEARANCE_MARGIN_AU, Math.max(parentVis * 0.35, childVis));
  const need = Math.max(parentVis + childVis + margin, parentVis * 1.85 + childVis);
  if (!(childOrbitQAu > 0) || !Number.isFinite(childOrbitQAu)) return 1;
  return childOrbitQAu >= need ? 1 : need / childOrbitQAu;
}

/** Viz-only input row for {@link parentFrameSharedDisplayScale}. */
export type ParentFrameChildOrbit = {
  qAu: number;
  aAu: number;
  e: number;
  vis: number;
};

/**
 * Per-parent shared viz-only display scale for all parent-frame children.
 * Starts from max({@link parentFrameDisplayScale}) among children (parent
 * clearance), then bumps so consecutive catalog-a siblings keep enough radial
 * gap between inner apoapsis and outer periapsis for both meshes + margin.
 * Catalog elements unchanged — display spacing only.
 */
export function parentFrameSharedDisplayScale(
  parentVis: number,
  children: ParentFrameChildOrbit[],
): number {
  if (!children.length) return 1;
  let s = 1;
  for (const c of children) {
    s = Math.max(s, parentFrameDisplayScale(c.qAu, parentVis, c.vis));
  }
  const sorted = [...children].sort((a, b) => a.aAu - b.aAu);
  for (let i = 0; i < sorted.length - 1; i++) {
    const inner = sorted[i]!;
    const outer = sorted[i + 1]!;
    const innerApo = inner.aAu * (1 + inner.e);
    const outerPeri = outer.aAu * (1 - outer.e);
    const gap = outerPeri - innerApo;
    const sepMargin = Math.min(
      PERIHELION_CLEARANCE_MARGIN_AU,
      Math.max(inner.vis, outer.vis),
    );
    const need = inner.vis + outer.vis + sepMargin;
    if (gap > 1e-12) {
      s = Math.max(s, need / gap);
    } else {
      // Crossing / nested-poor catalog pair: fall back to semi-major separation.
      const da = outer.aAu - inner.aAu;
      if (da > 1e-12) s = Math.max(s, need / da);
    }
  }
  return s;
}
