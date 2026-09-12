import { hasUsableOrbit, type Body } from "@/data/schema";

/** Honest Explore note when companions use the viz-only display ring. */
export const VISUAL_BINARY_NOTE =
  "Companion star positions are approximate — true orbits unknown.";

/** True when the system has at least one orbit-unknown companion star. */
export function hasVisualBinaryCompanions(bodies: readonly Body[]): boolean {
  return bodies.some(
    (b) => b.kind === "star" && Boolean(b.parentId) && !hasUsableOrbit(b),
  );
}
