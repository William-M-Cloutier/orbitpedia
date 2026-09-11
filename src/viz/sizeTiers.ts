import type { Body, BodyKind } from "@/data/schema";

/** Visual size tiers — NOT true scale. Scene units ≈ AU for orbits. */
export function visualRadius(body: Body): number {
  const tiers: Record<BodyKind, number> = {
    star: 0.35,
    planet: body.facts.radiusMeanKm > 20000 ? 0.18 : 0.1,
    dwarf_planet: 0.07,
    asteroid: 0.05,
  };
  return tiers[body.kind];
}
