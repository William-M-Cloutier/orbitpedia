import type { Body, BodyKind } from "@/data/schema";

/**
 * Visual mesh radii — render layer only. Orbit paths always use real AU.
 *
 * - schematic: readable size tiers (default)
 * - proportional: body radii in true ratio to each other from catalog
 *   radiusMeanKm (sun mesh capped so it never swallows Mercury's orbit)
 *
 * Adding a planet later = catalog facts only; this module maps radius → mesh.
 */

export type SizeMode = "schematic" | "proportional";

export const SIZE_MODES: { id: SizeMode; label: string; blurb: string }[] = [
  {
    id: "schematic",
    label: "Schematic",
    blurb: "Readable size tiers — not true scale",
  },
  {
    id: "proportional",
    label: "Proportional",
    blurb: "True radius ratios (sun capped for clearance)",
  },
];

export const DEFAULT_SIZE_MODE: SizeMode = "schematic";

/** Small rocky-planet schematic radius (Mercury / Venus / Earth / Mars). */
export const PLANET_VISUAL_RADIUS_SMALL = 0.1;

/** Gas-giant schematic radius. */
export const PLANET_VISUAL_RADIUS_LARGE = 0.18;

/**
 * Extra perihelion gap (AU) between schematic sun surface and body surface.
 * Required: a(1−e) ≥ STAR_VISUAL_RADIUS + bodyVisual + PERIHELION_CLEARANCE_MARGIN_AU
 */
export const PERIHELION_CLEARANCE_MARGIN_AU = 0.04;

/**
 * Schematic sun radius in scene AU.
 * Mercury perihelion q≈0.307 AU; with planet 0.1 + margin 0.04 → max sun ≈0.167.
 */
export const STAR_VISUAL_RADIUS = 0.12;

const AU_KM = 149_597_870.7;

/** Earth mean radius (km) — proportional reference. */
const EARTH_RADIUS_KM = 6_371;

/**
 * In proportional mode, Earth mesh radius (scene AU). Other bodies scale by
 * radiusMeanKm / Earth. Chosen so Jupiter (~11 R⊕) stays readable vs orbits.
 */
const PROPORTIONAL_EARTH_MESH_AU = 0.045;

/** Cap star mesh in proportional mode so Mercury's path stays clear. */
function proportionalStarCapAu(): number {
  // Mercury q≈0.307; leave room for a small body + margin.
  return 0.307 - PLANET_VISUAL_RADIUS_SMALL - PERIHELION_CLEARANCE_MARGIN_AU;
}

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

function proportionalRadius(body: Body): number {
  const raw =
    (body.facts.radiusMeanKm / EARTH_RADIUS_KM) * PROPORTIONAL_EARTH_MESH_AU;
  if (body.kind === "star") {
    // True sun/Earth ≈ 109 → would be huge; cap for orbit clearance.
    return Math.min(raw, Math.max(STAR_VISUAL_RADIUS, proportionalStarCapAu()));
  }
  // Floor so tiny asteroids stay clickable/visible.
  return Math.max(0.012, raw);
}

/** Visual mesh radius in scene units (≈ AU for orbit layout). */
export function visualRadius(
  body: Body,
  mode: SizeMode = DEFAULT_SIZE_MODE,
): number {
  return mode === "proportional"
    ? proportionalRadius(body)
    : schematicRadius(body);
}

/** True radius in AU (catalog), for tools/tests — not mesh size. */
export function physicalRadiusAu(body: Body): number {
  return body.facts.radiusMeanKm / AU_KM;
}
