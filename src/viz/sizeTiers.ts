import type { Body, BodyKind } from "@/data/schema";

/**
 * Visual size tiers — NOT true scale / NOT physical radii.
 *
 * Scene orbit geometry uses real AU (kepler positionAtMa). Mesh radii here are
 * schematic only so bodies stay clickable. Catalog / validate-catalog checks
 * periapsis against the REAL central radius (km→AU); THIS module checks
 * schematic clearance: q > visualRadius(sun) + visualRadius(body) + margin.
 * Never change orbit elements to fix mesh clipping — shrink these tiers.
 */

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
 * Keep well under that so the innermost path never clips the sun sphere.
 */
export const STAR_VISUAL_RADIUS = 0.12;

/** Minimum heliocentric distance (AU) that clears the schematic sun for a body radius. */
export function minClearanceAu(
  bodyRadius: number = PLANET_VISUAL_RADIUS_SMALL,
): number {
  return STAR_VISUAL_RADIUS + bodyRadius + PERIHELION_CLEARANCE_MARGIN_AU;
}

/** Visual size tiers — NOT true scale. Scene units ≈ AU for orbits. */
export function visualRadius(body: Body): number {
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
