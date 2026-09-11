import type { Body } from "@/data/schema";

/**
 * Procedural surface family — drives shared material look when no real map
 * is registered. Distinct by kind/traits so sparse catalogs still read as
 * intentional (rocky / gas / ice / star), not flat same-tint balls.
 */
export type SurfaceFamily = "star" | "gas" | "ice" | "rocky";

/** Gas-giant schematic threshold (matches sizeTiers large-planet cut). */
const GAS_RADIUS_KM = 20_000;
/** Above this → classic gas giant; below (but ≥ GAS) → ice giant band look. */
const CLASSIC_GAS_RADIUS_KM = 40_000;

/**
 * Infer surface family from catalog traits only (no invented science).
 * Prefer radius / density / albedo already on the card.
 */
export function inferSurfaceFamily(
  body: Pick<Body, "kind" | "facts">,
): SurfaceFamily {
  if (body.kind === "star") return "star";

  const r = body.facts.radiusMeanKm;
  const density = body.facts.densityGcm3;
  const albedo = body.facts.albedo;

  if (body.kind === "planet" && r != null && r > GAS_RADIUS_KM) {
    // Ice giants (Uranus/Neptune-class) vs gas giants (Jupiter/Saturn-class).
    return r < CLASSIC_GAS_RADIUS_KM ? "ice" : "gas";
  }

  // Bright icy moons / frost worlds.
  if (albedo != null && albedo >= 0.5) return "ice";

  // Low-density small bodies (cometary / icy dwarf-ish) when density is known.
  if (
    density != null &&
    density < 2.0 &&
    (r == null || r < 5_000) &&
    body.kind !== "planet"
  ) {
    return "ice";
  }

  return "rocky";
}

export function defaultFamilyColor(family: SurfaceFamily): string {
  switch (family) {
    case "star":
      return "#FDB813";
    case "gas":
      return "#C88B3A";
    case "ice":
      return "#A8D4E8";
    case "rocky":
    default:
      return "#8A8A8A";
  }
}
