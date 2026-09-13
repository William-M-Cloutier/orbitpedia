import type { Body } from "@/data/schema";

/**
 * Procedural surface family — drives shared material look when no real map
 * is registered. Distinct by kind/traits so sparse catalogs still read as
 * intentional (rocky / gas / ice / star / black_hole / small_body / comet),
 * not flat same-tint balls.
 */
export type SurfaceFamily =
  | "star"
  | "gas"
  | "ice"
  | "rocky"
  | "black_hole"
  | "small_body"
  | "comet";

/** Gas-giant schematic threshold (matches sizeTiers large-planet cut). */
const GAS_RADIUS_KM = 20_000;
/** Above this → classic gas giant; below (but ≥ GAS) → ice giant band look. */
const CLASSIC_GAS_RADIUS_KM = 40_000;

/**
 * Infer surface family from catalog traits only (no invented science).
 * Prefer radius / density / albedo already on the card.
 * Contract: kind → family internally (no appearance.surfaceFamily field).
 */
export function inferSurfaceFamily(
  body: Pick<Body, "kind" | "facts">,
): SurfaceFamily {
  if (body.kind === "star") return "star";
  if (body.kind === "black_hole") return "black_hole";
  if (body.kind === "probe") return "rocky";
  // Small bodies: dedicated rocky-lump family (not planet-smooth rocky/ice).
  if (body.kind === "asteroid") return "small_body";
  if (body.kind === "comet") return "comet";

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
    case "black_hole":
      // Deep purple-crimson disk tint — readable against starfield, not flat black.
      return "#4a1020";
    case "gas":
      return "#C88B3A";
    case "ice":
      return "#A8D4E8";
    case "small_body":
      // Dark mottled rock — catalog color still dominates when present.
      return "#6B5E52";
    case "comet":
      // Rocky nucleus + cool frost bias when catalog color missing.
      return "#7A8A8E";
    case "rocky":
    default:
      return "#8A8A8A";
  }
}
