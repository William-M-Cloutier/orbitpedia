import type { Body } from "@/data/schema";
import { EARTH_MASS_KG, EARTH_RADIUS_KM } from "@/lib/units";

/**
 * Matches archive ingest / Ephemeris hasGas (either threshold is enough):
 *   pl_bmasse ≳ 50 M⊕  OR  pl_rade ≳ 4 R⊕
 * Used to derive hasGas for curated Sol (and other curated systems with bodies).
 */
export const GAS_MASS_MEARTH = 50;
export const GAS_RADIUS_REARTH = 4;

/** True if this planet meets archive hasGas mass/radius cuts. */
export function bodyLooksGasGiant(
  body: Pick<Body, "kind" | "facts">,
): boolean {
  if (body.kind !== "planet") return false;
  const m = body.facts?.massKg;
  const r = body.facts?.radiusMeanKm;
  if (m != null && m / EARTH_MASS_KG >= GAS_MASS_MEARTH) return true;
  if (r != null && r / EARTH_RADIUS_KM >= GAS_RADIUS_REARTH) return true;
  return false;
}

/** True if any planet member meets hasGas thresholds. */
export function systemHasGasGiant(
  bodies: ReadonlyArray<Pick<Body, "kind" | "facts">>,
): boolean {
  return bodies.some(bodyLooksGasGiant);
}
