import type { Body, BodyKind } from "@/data/schema";
import { bodies } from "@/data/catalog";

/**
 * Visual mesh radii + orbit distance scale (render layer).
 *
 * - schematic: readable size tiers; orbits stay real AU (default)
 * - proportional / true: one linear scale for meshes AND orbits
 *   (sunMesh / sunPhysical). Planets are never swallowed by the sun.
 *   Proportional: sun largest, capped to clear Mercury on that scale.
 *   True: larger readable sun; same uniform scale for paths.
 *
 * Adding a planet later = catalog facts only; this module maps radius → mesh.
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
 * Extra perihelion gap (AU) between schematic sun surface and body surface.
 */
export const PERIHELION_CLEARANCE_MARGIN_AU = 0.04;

/**
 * Schematic sun radius in scene AU.
 * Mercury perihelion q≈0.307 AU; with planet 0.1 + margin 0.04 → max sun ≈0.167.
 */
export const STAR_VISUAL_RADIUS = 0.12;

const AU_KM = 149_597_870.7;

/** Mercury perihelion (AU) — used for proportional sun clearance. */
const MERCURY_Q_AU = 0.307;

export function minClearanceAu(
  bodyRadius: number = PLANET_VISUAL_RADIUS_SMALL,
): number {
  return STAR_VISUAL_RADIUS + bodyRadius + PERIHELION_CLEARANCE_MARGIN_AU;
}

function schematicRadius(body: Body): number {
  const tiers: Record<BodyKind, number> = {
    star: STAR_VISUAL_RADIUS,
    planet: body.facts.radiusMeanKm > 20000
      ? PLANET_VISUAL_RADIUS_LARGE
      : PLANET_VISUAL_RADIUS_SMALL,
    dwarf_planet: 0.07,
    asteroid: 0.05,
  };
  return tiers[body.kind];
}

/** Max non-star catalog radius (km) — for proportional fit. */
function maxNonStarRadiusKm(): number {
  let max = 0;
  for (const b of bodies) {
    if (b.kind === "star") continue;
    if (b.facts.radiusMeanKm > max) max = b.facts.radiusMeanKm;
  }
  return max > 0 ? max : 69_911; // Jupiter fallback
}

function mercuryRadiusKm(): number {
  const m = bodies.find((b) => b.id === "mercury");
  return m?.facts.radiusMeanKm ?? 2_439.7;
}

/**
 * Proportional: sun is the biggest mesh; other bodies keep true radius ratios
 * and are scaled so the sun still clears Mercury's perihelion.
 */
function proportionalRadius(body: Body): number {
  const mercKm = mercuryRadiusKm();
  const maxKm = maxNonStarRadiusKm();
  // Solve: sun = S, maxPlanet = 0.92*S, mercMesh = maxPlanet * (mercKm/maxKm)
  // S + mercMesh + margin <= Mercury q
  // S * (1 + 0.92 * mercKm/maxKm) <= q - margin
  const ratioMercToMax = mercKm / maxKm;
  const denom = 1 + 0.92 * ratioMercToMax;
  const sunMesh = (MERCURY_Q_AU - PERIHELION_CLEARANCE_MARGIN_AU) / denom;
  const scale = (0.92 * sunMesh) / maxKm; // km → scene AU

  if (body.kind === "star") {
    return sunMesh; // largest by construction
  }
  return Math.max(0.008, body.facts.radiusMeanKm * scale);
}

/**
 * True ratios: readable sun mesh; every body scales by radiusMeanKm / R_sun.
 * orbitDistanceScale expands paths by the same factor so Mercury stays outside.
 */
const TRUE_SUN_MESH_AU = 0.85;

function trueRadius(body: Body): number {
  const sun = bodies.find((b) => b.kind === "star") ?? bodies.find((b) => b.id === "sun");
  const sunKm = sun?.facts.radiusMeanKm ?? 695_700;
  const scale = TRUE_SUN_MESH_AU / sunKm; // km → scene AU
  return Math.max(1e-6, body.facts.radiusMeanKm * scale);
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
  return body.facts.radiusMeanKm / AU_KM;
}

/**
 * Scale factor for orbit distances (and bary wobble) so mesh sizes and paths
 * share one linear scale. Schematic keeps real AU (1). Proportional/True use
 * sunMesh / sunPhysical so planets are not swallowed by a magnified sun.
 */
export function orbitDistanceScale(mode: SizeMode = DEFAULT_SIZE_MODE): number {
  if (mode === "schematic") return 1;
  const sun =
    bodies.find((b) => b.kind === "star") ??
    bodies.find((b) => b.id === "sun");
  if (!sun) return 1;
  const physical = physicalRadiusAu(sun);
  if (!(physical > 0)) return 1;
  return visualRadius(sun, mode) / physical;
}
