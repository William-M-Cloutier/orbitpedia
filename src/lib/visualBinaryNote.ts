import { hasUsableOrbit, type Body } from "@/data/schema";

/** Honest Explore note when companions lack a full catalog orbit. */
export const VISUAL_BINARY_NOTE =
  "Due to limited data, companion star positions aren’t accurate.";

/**
 * Companion star with no usable Kepler (schematic ring and/or projected
 * separation only). True orbits unknown either way.
 */
export function isVisualBinaryCompanion(body: Body): boolean {
  return body.kind === "star" && Boolean(body.parentId) && !hasUsableOrbit(body);
}

/** True when any member uses schematic / sep-without-full-orbit placement. */
export function hasVisualBinaryCompanions(bodies: readonly Body[]): boolean {
  return bodies.some((b) => isVisualBinaryCompanion(b));
}

/** Display string for facts.projectedSepAu when present (never invent). */
export function projectedSepDisplay(body: Body): string | null {
  const sep = body.facts.projectedSepAu;
  if (sep == null || !Number.isFinite(sep) || sep <= 0) return null;
  const approx =
    Array.isArray(body.facts.approximateFields) &&
    body.facts.approximateFields.includes("projectedSepAu");
  const n =
    sep < 10 ? Number(sep.toPrecision(3)) : sep < 100 ? Number(sep.toPrecision(3)) : Math.round(sep);
  const text = `${n} au`;
  return approx && !text.startsWith("~") ? `~${text}` : text;
}
