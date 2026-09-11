import { hasUsableOrbit, type Body, type BodyKind } from "@/data/schema";
import { getBody, getHomeSystemGraph, getSystemGraph } from "@/data/catalog";

/**
 * Visual mesh radii (render layer). LOCKED scale contract — do not one-off
 * tweak per body when seeding moons/planets. New cards only add catalog
 * facts; these formulas must apply unchanged.
 *
 * Orbit paths stay in real AU (Explore zoom box min~0.425, max~80).
 *
 * - schematic: fixed tiers for star/planet/dwarf/asteroid; moons =
 *   parentMesh * (R_moon/R_parent) clamped [MIN, MAX_OF_PARENT]
 * - proportional: one system-local km→scene scale (star largest, inner
 *   primary-frame clearance body)
 * - true: one system-local km→scene scale (star clearance); honest tiny planets
 *
 * Prop/True dial off the *active* system graph (star + innermost non-star
 * primary-frame perihelion) — never hardcode Sol/Mercury ids.
 *
 * Never explode orbit distances to match a magnified sun. Parent-frame orbit
 * display spacing is separate (parentFrameSharedDisplayScale) and also
 * formula-driven — not per-moon constants.
 *
 * Adding a body later = Store B card only; sizeTiers maps radius → mesh.
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

/** Fallback when a system has no usable primary-frame orbiter (rare). */
const FALLBACK_INNER_Q_AU = 0.307;
const FALLBACK_INNER_RADIUS_KM = 2_439.7;
const FALLBACK_STAR_RADIUS_KM = 695_700;
const FALLBACK_MAX_NON_STAR_KM = 69_911;

export function minClearanceAu(
  bodyRadius: number = PLANET_VISUAL_RADIUS_SMALL,
): number {
  return STAR_VISUAL_RADIUS + bodyRadius + PERIHELION_CLEARANCE_MARGIN_AU;
}

/** Cap moon mesh as a fraction of its parent schematic mesh (readability). */
const SCHEMATIC_MOON_MAX_OF_PARENT = 0.45;
const SCHEMATIC_MOON_MIN = 0.012;

function schematicRadiusNonMoon(body: Body): number {
  const tiers: Record<Exclude<BodyKind, "moon">, number> = {
    star: STAR_VISUAL_RADIUS,
    planet: (body.facts.radiusMeanKm ?? 0) > 20000
      ? PLANET_VISUAL_RADIUS_LARGE
      : PLANET_VISUAL_RADIUS_SMALL,
    dwarf_planet: 0.07,
    asteroid: 0.05,
  };
  return tiers[body.kind as Exclude<BodyKind, "moon">] ?? 0.05;
}

/**
 * Schematic moons use the same rule everywhere: parentMesh * (R_moon/R_parent),
 * clamped for readability. Flat moon tier made Charon ~57% of Pluto while
 * tiny moons looked fine under gas giants — inconsistent scale.
 */
function schematicRadius(body: Body): number {
  if (body.kind === "moon") {
    const parent = body.parentId ? getBody(body.parentId) : undefined;
    if (parent && parent.kind !== "moon") {
      const parentVis = schematicRadiusNonMoon(parent);
      const pKm = parent.facts.radiusMeanKm ?? 0;
      const cKm = body.facts.radiusMeanKm ?? 0;
      if (pKm > 0 && cKm > 0) {
        const ratio = cKm / pKm;
        return Math.min(
          parentVis * SCHEMATIC_MOON_MAX_OF_PARENT,
          Math.max(SCHEMATIC_MOON_MIN, parentVis * ratio),
        );
      }
    }
    return SCHEMATIC_MOON_MIN;
  }
  return schematicRadiusNonMoon(body);
}

/** Periapsis (AU) from elements — matches catalog qAu when present. */
function orbitQAu(orbit: NonNullable<Body["orbit"]>): number {
  if (orbit.qAu != null && Number.isFinite(orbit.qAu)) return orbit.qAu;
  return orbit.aAu * (1 - orbit.e);
}

/**
 * Resolve the system graph Prop/True dial against. Prefer explicit bodies
 * (Explore active system); else the body's systemId; else home.
 */
function resolveSystemBodies(
  body: Body,
  systemBodies?: readonly Body[],
): readonly Body[] {
  if (systemBodies && systemBodies.length > 0) return systemBodies;
  if (body.systemId) {
    try {
      return getSystemGraph(body.systemId).bodies;
    } catch {
      /* fall through */
    }
  }
  return getHomeSystemGraph().bodies;
}

/** Clearance star = system kind==="star" (prefer root / no parentId). */
function systemStar(bodies: readonly Body[]): Body | undefined {
  return (
    bodies.find((b) => b.kind === "star" && !b.parentId) ??
    bodies.find((b) => b.kind === "star")
  );
}

/**
 * Inner clearance reference: smallest perihelion among non-star bodies with a
 * usable *primary-frame* orbit (frame !== "parent") in this system.
 */
function innermostPrimaryOrbitBody(
  bodies: readonly Body[],
): Body | undefined {
  let best: Body | undefined;
  let bestQ = Infinity;
  for (const b of bodies) {
    if (b.kind === "star") continue;
    if (!hasUsableOrbit(b)) continue;
    if (b.orbit.frame === "parent") continue;
    const q = orbitQAu(b.orbit);
    if (!(q > 0) || !Number.isFinite(q)) continue;
    if (q < bestQ) {
      bestQ = q;
      best = b;
    }
  }
  return best;
}

/** Max non-star radius (km) in the active system — for proportional fit. */
function maxNonStarRadiusKm(bodies: readonly Body[]): number {
  let max = 0;
  for (const b of bodies) {
    if (b.kind === "star") continue;
    const r = b.facts.radiusMeanKm;
    if (r != null && r > max) max = r;
  }
  return max > 0 ? max : FALLBACK_MAX_NON_STAR_KM;
}

function starRadiusKm(bodies: readonly Body[]): number {
  const star = systemStar(bodies);
  return star?.facts.radiusMeanKm ?? FALLBACK_STAR_RADIUS_KM;
}

/**
 * Margin capped so compact exoplanet systems (q ≪ 0.04 AU) still get a
 * positive clearance budget. Solar Mercury q≈0.307 → full 0.04 margin.
 */
function clearanceMarginAu(innerQAu: number): number {
  if (!(innerQAu > 0) || !Number.isFinite(innerQAu)) {
    return PERIHELION_CLEARANCE_MARGIN_AU;
  }
  return Math.min(PERIHELION_CLEARANCE_MARGIN_AU, innerQAu * 0.25);
}

type ClearanceRefs = {
  starKm: number;
  maxNonStarKm: number;
  innerKm: number;
  innerQAu: number;
};

function clearanceRefs(bodies: readonly Body[]): ClearanceRefs {
  const inner = innermostPrimaryOrbitBody(bodies);
  const innerQAu =
    inner && hasUsableOrbit(inner)
      ? orbitQAu(inner.orbit)
      : FALLBACK_INNER_Q_AU;
  return {
    starKm: starRadiusKm(bodies),
    maxNonStarKm: maxNonStarRadiusKm(bodies),
    innerKm: inner?.facts.radiusMeanKm ?? FALLBACK_INNER_RADIUS_KM,
    innerQAu: innerQAu > 0 ? innerQAu : FALLBACK_INNER_Q_AU,
  };
}

/**
 * Proportional: star is the biggest mesh; other bodies keep true radius ratios
 * and are scaled so the star still clears the innermost primary-frame
 * perihelion on real AU.
 */
function proportionalRadius(body: Body, bodies: readonly Body[]): number {
  const { maxNonStarKm, innerKm, innerQAu } = clearanceRefs(bodies);
  // Solve: star = S, maxPlanet = 0.92*S, innerMesh = maxPlanet * (innerKm/maxKm)
  // S + innerMesh + margin <= inner q
  const ratioInnerToMax = innerKm / maxNonStarKm;
  const denom = 1 + 0.92 * ratioInnerToMax;
  const margin = clearanceMarginAu(innerQAu);
  const sunMesh = (innerQAu - margin) / denom;
  const scale = (0.92 * sunMesh) / maxNonStarKm; // km → scene AU

  if (body.kind === "star") {
    return sunMesh; // largest by construction
  }
  const km = body.facts.radiusMeanKm ?? 1;
  return Math.max(0.008, km * scale);
}

/**
 * True ratios on real-AU orbits: starMesh * (1 + R_inner/R_star) + margin <= q.
 * Planets stay tiny vs the star (honest) and the system fits the zoom box.
 */
function trueRadius(body: Body, bodies: readonly Body[]): number {
  const { starKm, innerKm, innerQAu } = clearanceRefs(bodies);
  const denom = 1 + innerKm / starKm;
  const margin = clearanceMarginAu(innerQAu);
  const sunMesh = (innerQAu - margin) / denom;
  const scale = sunMesh / starKm; // km → scene AU
  const km = body.facts.radiusMeanKm ?? 1;
  return Math.max(1e-6, km * scale);
}

/**
 * Visual mesh radius in scene units (≈ AU for orbit layout).
 * Pass `systemBodies` from Explore's active graph when available; otherwise
 * Prop/True resolve via `body.systemId` (never silent Sol for exoplanets).
 */
export function visualRadius(
  body: Body,
  mode: SizeMode = DEFAULT_SIZE_MODE,
  systemBodies?: readonly Body[],
): number {
  if (mode === "proportional" || mode === "true") {
    const bodies = resolveSystemBodies(body, systemBodies);
    if (mode === "proportional") return proportionalRadius(body, bodies);
    return trueRadius(body, bodies);
  }
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

/**
 * Viz-only primary-frame (heliocentric / star-centered) display scale for ANY
 * system. Formula — not per-system magic:
 * 1) Star↔periapsis clearance for every primary-frame orbiter (incl. asteroids).
 * 2) Sibling mesh-gap inflate only for planet + dwarf_planet (asteroids often
 *    cross; including them once blew Schematic Sol ~35× via Vesta/Ceres).
 * Catalog a/e/i unchanged. Moons use {@link parentFrameSharedDisplayScale}.
 */
export function heliocentricSharedDisplayScale(
  starVis: number,
  primaryOrbiters: ReadonlyArray<{
    kind: Body["kind"];
    qAu: number;
    aAu: number;
    e: number;
    vis: number;
  }>,
): number {
  if (!(starVis > 0) || !Number.isFinite(starVis)) return 1;
  let s = 1;
  for (const c of primaryOrbiters) {
    s = Math.max(s, parentFrameDisplayScale(c.qAu, starVis, c.vis));
  }
  const spaced = primaryOrbiters.filter(
    (c) => c.kind === "planet" || c.kind === "dwarf_planet",
  );
  if (spaced.length > 0) {
    s = Math.max(s, parentFrameSharedDisplayScale(starVis, spaced));
  }
  return s;
}
