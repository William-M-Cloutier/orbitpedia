import type { Body, BodyKind } from "@/data/schema";
import { bodies } from "@/data/catalog";

/**
 * Visual mesh radii — render layer only. Orbit paths always use real AU.
 *
 * - schematic: readable size tiers (default)
 * - proportional: true radius ratios; sun is largest mesh and still clears
 *   Mercury's orbit (planets scaled to fit under that sun)
 * - true: physical radii in AU (uncapped sun). Orbits stay correct so meshes
 *   do not intersect paths; bodies are tiny in the system view.
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

/** True physical radius in scene AU (uncapped). */
function trueRadius(body: Body): number {
  return body.facts.radiusMeanKm / AU_KM;
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
