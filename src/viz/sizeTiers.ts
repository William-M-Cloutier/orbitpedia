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
 * Companion / placeholder stars lacking radiusMeanKm use a display-only
 * fraction of the primary mesh in Prop/True — not an invented catalog radius.
 * Primary stars keep clearance sunMesh (star-readable) even when R is missing.
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

/**
 * Prop/True display mesh for companion stars with no radiusMeanKm.
 * Fraction of primary sunMesh — viz fallback only, never written as catalog R.
 */
const STAR_NO_RADIUS_COMPANION_MESH_FRAC = 0.4;

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
/**
 * When primary planet/dwarf schematic meshes would force a huge orbit inflate
 * past star-clearance scale, shrink those meshes (shared factor) instead of
 * blowing the system — keeps the star readable. Sol: factor 1 (unchanged).
 */
function schematicPrimaryMeshFactor(bodies: readonly Body[]): number {
  const star = systemStar(bodies);
  if (!star) return 1;
  const starVis = schematicRadiusNonMoon(star);
  const kids = bodies.filter(
    (b) => hasUsableOrbit(b) && b.orbit?.frame !== "parent",
  );
  if (kids.length === 0) return 1;
  const rows = kids.map((c) => ({
    kind: c.kind,
    qAu: orbitQAu(c.orbit!),
    aAu: c.orbit!.aAu,
    e: c.orbit!.e,
    vis: schematicRadiusNonMoon(c),
  }));
  let starOnly = 1;
  for (const c of rows) {
    starOnly = Math.max(starOnly, parentFrameDisplayScale(c.qAu, starVis, c.vis));
  }
  const spaced = rows.filter(
    (c) => c.kind === "planet" || c.kind === "dwarf_planet",
  );
  const shared =
    spaced.length > 0
      ? parentFrameSharedDisplayScale(starVis, spaced)
      : starOnly;
  if (!(shared > starOnly * 1.01)) return 1;
  return starOnly / shared;
}

function schematicRadius(body: Body, systemBodies?: readonly Body[]): number {
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
  const base = schematicRadiusNonMoon(body);
  if (body.kind !== "planet" && body.kind !== "dwarf_planet") return base;
  const bodies = resolveSystemBodies(body, systemBodies);
  return base * schematicPrimaryMeshFactor(bodies);
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
 * Primary / root star for Prop/True sunMesh clearance.
 * Companions have parentId set; root = systemStar (!parentId). Explore also
 * uses system.primaryStarId — same body when catalog is consistent.
 */
function isSystemPrimaryStar(body: Body, bodies: readonly Body[]): boolean {
  if (body.kind !== "star") return false;
  if (body.parentId) return false;
  const star = systemStar(bodies);
  return star != null && star.id === body.id;
}

/** Catalog radius when positive; else null (missing / unusable placeholder). */
function catalogRadiusKm(body: Body): number | null {
  const r = body.facts.radiusMeanKm;
  return r != null && r > 0 && Number.isFinite(r) ? r : null;
}

/**
 * Companion star display mesh vs primary Prop/True sunMesh.
 * Known R → radius ratio capped at primary; missing R → fixed fraction.
 * Display-only — never invents a catalog radiusMeanKm.
 */
function companionStarMesh(
  body: Body,
  bodies: readonly Body[],
  sunMesh: number,
): number {
  const km = catalogRadiusKm(body);
  if (km == null) {
    return sunMesh * STAR_NO_RADIUS_COMPANION_MESH_FRAC;
  }
  const primaryKm = starRadiusKm(bodies);
  return Math.min(
    sunMesh,
    Math.max(1e-6, sunMesh * (km / Math.max(primaryKm, 1))),
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
  // S + innerMesh + margin <= inner q  (clearance S).
  // Clearance S from inner primary-frame perihelion (formula, no Sol ids).
  // Do NOT floor at STAR_VISUAL_RADIUS: that pinned Prop/True star mesh to the
  // schematic tier in compact systems (TRAPPIST/Kepler) so size modes looked
  // identical and forced huge helio orbit inflate. Sol clearance S ≫ schematic
  // tier (~0.26) so Sol Prop feel is unchanged. Explore framing zooms compact
  // systems so small absolute meshes stay readable.
  const ratioInnerToMax =
    maxNonStarKm > 0 ? innerKm / maxNonStarKm : 1;
  const denom = 1 + 0.92 * ratioInnerToMax;
  const margin = clearanceMarginAu(innerQAu);
  const sunMesh = Math.max(1e-6, (innerQAu - margin) / denom);
  const scale = (0.92 * sunMesh) / Math.max(maxNonStarKm, 1); // km → scene

  if (body.kind === "star") {
    // Primary: clearance sunMesh (star-readable), even if catalog R missing.
    if (isSystemPrimaryStar(body, bodies)) return sunMesh;
    return companionStarMesh(body, bodies, sunMesh);
  }
  const km = body.facts.radiusMeanKm ?? 1;
  // No absolute 0.008 floor — it exceeded sunMesh on TRAPPIST and made
  // planets bigger than the star.
  return Math.min(sunMesh * 0.92, Math.max(1e-6, km * scale));
}

/**
 * True ratios on real-AU orbits: starMesh * (1 + R_inner/R_star) + margin <= q.
 * Planets stay tiny vs the star (honest) and the system fits the zoom box.
 */
function trueRadius(body: Body, bodies: readonly Body[]): number {
  const { starKm, innerKm, innerQAu } = clearanceRefs(bodies);
  const denom = 1 + innerKm / Math.max(starKm, 1);
  const margin = clearanceMarginAu(innerQAu);
  // No schematic-tier floor — same rationale as proportionalRadius.
  const sunMesh = Math.max(1e-6, (innerQAu - margin) / denom);
  const scale = sunMesh / Math.max(starKm, 1);

  if (body.kind === "star") {
    // Primary: star-readable clearance mesh (not km??1 which vanishes).
    if (isSystemPrimaryStar(body, bodies)) return sunMesh;
    // Companions stay visible: missing R → fraction; known R → ratio, ≤ primary.
    return companionStarMesh(body, bodies, sunMesh);
  }
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
  return schematicRadius(body, systemBodies);
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

/**
 * Raw minimum heliocentric display scale so every primary-frame perihelion
 * still clears starVis + childVis + margin. Same need as
 * {@link parentFrameDisplayScale}, but **not** floored at 1 — used after
 * schematic fitScale may compress clearanceHelio below the perihelion
 * requirement. Catalog aAu unchanged.
 */
export function perihelionClearanceFloor(
  bodies: readonly Body[],
  sizeMode: SizeMode = DEFAULT_SIZE_MODE,
): number {
  const star = systemStar(bodies);
  if (!star) return 0;
  const starVis = visualRadius(star, sizeMode, bodies);
  if (!(starVis > 0) || !Number.isFinite(starVis)) return 0;
  let floor = 0;
  for (const b of bodies) {
    if (!hasUsableOrbit(b) || b.orbit?.frame === "parent") continue;
    const q = orbitQAu(b.orbit!);
    if (!(q > 0) || !Number.isFinite(q)) continue;
    const childVis = visualRadius(b, sizeMode, bodies);
    const margin = Math.min(
      PERIHELION_CLEARANCE_MARGIN_AU,
      Math.max(starVis * 0.35, childVis),
    );
    const need = Math.max(
      starVis + childVis + margin,
      starVis * 1.85 + childVis,
    );
    const req = need / q;
    if (Number.isFinite(req) && req > floor) floor = req;
  }
  return floor;
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
