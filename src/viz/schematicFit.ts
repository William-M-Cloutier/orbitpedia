import { hasUsableOrbit, type Body } from "@/data/schema";
import {
  PERIHELION_CLEARANCE_MARGIN_AU,
  parentFrameSharedDisplayScale,
  visualRadius,
  type SizeMode,
} from "./sizeTiers";

/**
 * Schematic idle framing for wide / sparse systems.
 *
 * Explore idle frames the full orbit extent. On wide hosts (e.g. 51 Eri,
 * 14 Her) STAR_VISUAL_RADIUS + helioScale leave the primary (and companions)
 * as pixels. Viz-only display compress (`fitScale ∈ (0,1]`) shrinks primary-
 * frame orbit display and companion seps so idle pull-in raises star fill
 * toward ~8–12%. Catalog aAu unchanged. Home (Sol) always uses fitScale=1
 * via the caller — do not special-case body ids here.
 *
 * Prop/True and STAR_VISUAL_RADIUS / clearance solvers are untouched.
 * After fit, OrbitScene floors helioScale at perihelionClearanceFloor and
 * companion sep at mesh radii + margin so compress cannot bury bodies.
 */

/** Legacy Sol idle camera offset (Canvas default). Direction reused; distance from {@link idleCameraDistance}. */
export const IDLE_CAMERA_OFFSET = [0, 8, 14] as const;

export const IDLE_CAMERA_DIST_LEGACY = Math.hypot(
  IDLE_CAMERA_OFFSET[0],
  IDLE_CAMERA_OFFSET[1],
  IDLE_CAMERA_OFFSET[2],
);

/**
 * Compact-system idle pad: sceneExtent × pad → camera distance.
 * Large systems whose extent × pad exceeds legacy (Sol) keep
 * {@link IDLE_CAMERA_DIST_LEGACY}.
 */
export const IDLE_EXTENT_PAD = 1.17;

/** Star on-screen diameter fraction below which schematic fit engages. */
export const STAR_IDLE_FILL_MIN = 0.08;

/** Target star idle fill when compressing wide schematic systems. */
export const STAR_IDLE_FILL_TARGET = 0.1;

/**
 * Floor on schematic orbit fit scale — never crush display more than ~6.7×.
 * Mild enough to preserve planetary structure on mid-wide hosts.
 */
export const SCHEMATIC_FIT_MIN = 0.15;

/** Default Explore PerspectiveCamera fov (degrees). */
export const SCHEMATIC_FIT_FOV_Y_DEG = 45;

// --- Visual-binary display sep (shared with OrbitScene placement) ---

export const VISUAL_BINARY_SEP_FACTOR = 1.3;
export const VISUAL_BINARY_MIN_SEP = 0.04;
export const VISUAL_BINARY_CLEARANCE_MARGIN = 0.005;
/** Viz-only ecliptic-z lift so companions sit off the face-on planet ring plane. */
export const COMPANION_OUT_OF_PLANE_FRAC = 0.5;
export const PROJECTED_SEP_LOG_SCALE = 3.0;
export const PROJECTED_SEP_DISPLAY_CAP_AU = 36;
export const PROJECTED_SEP_ORBIT_FLOOR_FACTOR = 1.2;

/**
 * Idle Explore camera distance from system scene extent (formula only).
 * Compact hosts pull in; Sol-scale extents stay on the legacy framing.
 */
export function idleCameraDistance(extent: number): number {
  if (!(extent > 1e-6) || !Number.isFinite(extent)) {
    return IDLE_CAMERA_DIST_LEGACY;
  }
  return Math.min(IDLE_CAMERA_DIST_LEGACY, extent * IDLE_EXTENT_PAD);
}

/**
 * Primary-frame scene extent (display au): max apoapsis × helioScale.
 * Prefer planet/dwarf (same set that defines the face-on plane); fall back to
 * all primary-frame orbiters so asteroid-only graphs still frame.
 */
export function systemSceneExtent(
  bodies: readonly Body[],
  helioScale: number,
): number {
  const hs = helioScale > 0 && Number.isFinite(helioScale) ? helioScale : 1;
  const primary = bodies.filter(
    (b) => hasUsableOrbit(b) && b.orbit?.frame !== "parent",
  );
  const preferred = primary.filter(
    (b) => b.kind === "planet" || b.kind === "dwarf_planet",
  );
  const pool = preferred.length > 0 ? preferred : primary;
  let maxApo = 0;
  for (const b of pool) {
    const o = b.orbit!;
    const apo = o.aAu * (1 + o.e);
    if (Number.isFinite(apo) && apo > maxApo) maxApo = apo;
  }
  return maxApo * hs;
}


/**
 * Viz-only floor on companion display sep so parent-frame kids orbiting an
 * orbit-unknown companion cannot reach into the primary mesh (worst-case apo
 * toward the primary ≈ sep − aAu(1+e)·ps). Returns 0 when there are no such
 * kids — Sol moons / planet hosts never hit this path (not visual-binary).
 */
export function visualBinaryKidsClearanceSep(
  companion: Body,
  sizeMode: SizeMode,
  systemBodies: readonly Body[],
): number {
  if (companion.kind !== "star" || !companion.parentId || hasUsableOrbit(companion)) {
    return 0;
  }
  const kids = systemBodies.filter(
    (c) =>
      c.parentId === companion.id &&
      c.orbit?.frame === "parent" &&
      hasUsableOrbit(c),
  );
  if (kids.length === 0) return 0;

  const primary =
    systemBodies.find((b) => b.id === companion.parentId) ??
    systemBodies.find((b) => b.kind === "star" && !b.parentId);
  const rPrimary = primary
    ? visualRadius(primary, sizeMode, systemBodies)
    : visualRadius(companion, sizeMode, systemBodies);
  const parentVis = visualRadius(companion, sizeMode, systemBodies);
  const rows = kids.map((c) => {
    const o = c.orbit!;
    const qAu =
      o.qAu != null && Number.isFinite(o.qAu) ? o.qAu : o.aAu * (1 - o.e);
    return {
      qAu,
      aAu: o.aAu,
      e: o.e,
      vis: visualRadius(c, sizeMode, systemBodies),
    };
  });
  const ps = parentFrameSharedDisplayScale(parentVis, rows);
  let maxApo = 0;
  let maxChildVis = 0;
  for (const r of rows) {
    const apo = r.aAu * (1 + r.e) * ps;
    if (Number.isFinite(apo) && apo > maxApo) maxApo = apo;
    if (r.vis > maxChildVis) maxChildVis = r.vis;
  }
  const margin = Math.min(
    PERIHELION_CLEARANCE_MARGIN_AU,
    Math.max(rPrimary * 0.35, maxChildVis),
  );
  // companionSep - maxApo >= rPrimary + childVis + margin
  return maxApo + rPrimary + maxChildVis + margin;
}


/**
 * Viz-only floor so orbit-unknown companions sit outside the outermost
 * primary-frame planet display apoapsis (hot-Jupiter + mesh-only companions).
 * Uses effective helioScale (clearance-floored × fit) so display rings and
 * companion sep share the same radial scale. Catalog aAu unchanged.
 */
export function visualBinaryHelioPlanetClearanceSep(
  companion: Body,
  sizeMode: SizeMode,
  systemBodies: readonly Body[],
  helioScale: number,
): number {
  if (companion.kind !== "star" || !companion.parentId || hasUsableOrbit(companion)) {
    return 0;
  }
  const hs = helioScale > 0 && Number.isFinite(helioScale) ? helioScale : 1;
  let outerApoDisplay = 0;
  let maxPlanetVis = 0;
  for (const b of systemBodies) {
    if (!hasUsableOrbit(b) || b.orbit?.frame === "parent") continue;
    const o = b.orbit!;
    const apo = o.aAu * (1 + o.e) * hs;
    if (Number.isFinite(apo) && apo > outerApoDisplay) outerApoDisplay = apo;
    const vis = visualRadius(b, sizeMode, systemBodies);
    if (Number.isFinite(vis) && vis > maxPlanetVis) maxPlanetVis = vis;
  }
  if (!(outerApoDisplay > 0)) return 0;
  const rSelf = visualRadius(companion, sizeMode, systemBodies);
  const margin = Math.min(
    PERIHELION_CLEARANCE_MARGIN_AU,
    Math.max(VISUAL_BINARY_CLEARANCE_MARGIN, maxPlanetVis),
  );
  // companionSep >= outer planet display apo + companion mesh + planet mesh + margin
  return outerApoDisplay + rSelf + maxPlanetVis + margin;
}

/**
 * Viz-only display separation (scene AU) for one orbit-unknown companion.
 * Same formula as Explore visual-binary placement — catalog projectedSepAu
 * unchanged (log1p compress + cap when set; else mesh-radii schematic).
 */
export function visualBinaryDisplaySep(
  body: Body,
  sizeMode: SizeMode,
  systemBodies: readonly Body[],
): number {
  if (body.kind !== "star" || !body.parentId || hasUsableOrbit(body)) {
    return 0;
  }
  const parent =
    systemBodies.find((b) => b.id === body.parentId) ??
    systemBodies.find((b) => b.kind === "star" && !b.parentId);
  const rPrimary = parent
    ? visualRadius(parent, sizeMode, systemBodies)
    : visualRadius(body, sizeMode, systemBodies);
  const rSelf = visualRadius(body, sizeMode, systemBodies);
  const schematicSep = Math.max(
    (rPrimary + rSelf) * VISUAL_BINARY_SEP_FACTOR,
    VISUAL_BINARY_MIN_SEP,
  );
  const projected = body.facts?.projectedSepAu;
  if (
    typeof projected !== "number" ||
    !Number.isFinite(projected) ||
    !(projected > 0)
  ) {
    return Math.max(
      schematicSep,
      visualBinaryKidsClearanceSep(body, sizeMode, systemBodies),
    );
  }
  let outerPrimaryOrbitA = 0;
  for (const b of systemBodies) {
    if (!hasUsableOrbit(b) || b.orbit?.frame === "parent") continue;
    const a = b.orbit!.aAu;
    if (Number.isFinite(a) && a > outerPrimaryOrbitA) outerPrimaryOrbitA = a;
  }
  const floor =
    outerPrimaryOrbitA > 0
      ? Math.max(
          schematicSep,
          outerPrimaryOrbitA * PROJECTED_SEP_ORBIT_FLOOR_FACTOR,
        )
      : schematicSep;
  const compressed = Math.log1p(projected) * PROJECTED_SEP_LOG_SCALE;
  let sep = Math.min(
    PROJECTED_SEP_DISPLAY_CAP_AU,
    Math.max(floor, compressed),
  );
  sep = Math.max(sep, rPrimary + rSelf + VISUAL_BINARY_CLEARANCE_MARGIN);
  // Parent-frame kids around this companion must not reach into the primary.
  sep = Math.max(sep, visualBinaryKidsClearanceSep(body, sizeMode, systemBodies));
  return sep;
}

/** Max orbit-unknown companion display sep (scene AU) in the graph. */
export function maxCompanionDisplaySep(
  bodies: readonly Body[],
  sizeMode: SizeMode = "schematic",
): number {
  let max = 0;
  for (const b of bodies) {
    if (b.kind !== "star" || !b.parentId || hasUsableOrbit(b)) continue;
    const sep = visualBinaryDisplaySep(b, sizeMode, bodies);
    if (sep > max) max = sep;
  }
  return max;
}

/**
 * Viz-only radial separation for marker-only probes (kind===probe without
 * usable Kepler / path.waypoints).
 *
 * **NOT an ephemeris / NOT a trajectory** — placeholders until schema has
 * path.waypoints. Do not invent Horizons samples or fake Kepler elements.
 *
 * Outside outermost primary-frame planet (or orbiter) display apoapsis
 * (aAu*(1+e)*helioScale) + probe mesh + outermost mesh + margin. Shared ring
 * for all probes in the graph; angles assigned in OrbitScene (stable id sort).
 * Catalog aAu / cards unchanged.
 */
export function probeMarkerDisplaySep(
  sizeMode: SizeMode,
  systemBodies: readonly Body[],
  helioScale: number,
): number {
  const probes = systemBodies.filter(
    (b) => b.kind === "probe" && !hasUsableOrbit(b),
  );
  if (probes.length === 0) return 0;
  const hs = helioScale > 0 && Number.isFinite(helioScale) ? helioScale : 1;
  let outerApoDisplay = 0;
  let maxOrbiterVis = 0;
  for (const b of systemBodies) {
    if (!hasUsableOrbit(b) || b.orbit?.frame === "parent") continue;
    const o = b.orbit!;
    const apo = o.aAu * (1 + o.e) * hs;
    if (Number.isFinite(apo) && apo > outerApoDisplay) outerApoDisplay = apo;
    const vis = visualRadius(b, sizeMode, systemBodies);
    if (Number.isFinite(vis) && vis > maxOrbiterVis) maxOrbiterVis = vis;
  }
  // Representative probe mesh (tiers are kind-uniform; no per-probe magic).
  const rSelf = visualRadius(probes[0]!, sizeMode, systemBodies);
  const margin = Math.min(
    PERIHELION_CLEARANCE_MARGIN_AU,
    Math.max(VISUAL_BINARY_CLEARANCE_MARGIN, maxOrbiterVis),
  );
  // Never stack on the Sun even when the graph has no primary-frame orbiters.
  return Math.max(
    outerApoDisplay + rSelf + maxOrbiterVis + margin,
    rSelf + VISUAL_BINARY_CLEARANCE_MARGIN + 0.5,
  );
}


/**
 * Framing extent for schematic idle / fit: planet apo×helio plus companion
 * display seps so wide visual-binary hosts frame correctly.
 */
export function schematicFramingExtent(
  bodies: readonly Body[],
  helioScale: number,
  sizeMode: SizeMode = "schematic",
): number {
  let max = Math.max(
    systemSceneExtent(bodies, helioScale),
    maxCompanionDisplaySep(bodies, sizeMode),
    probeMarkerDisplaySep(sizeMode, bodies, helioScale),
  );
  for (const b of bodies) {
    if (b.kind !== "star" || !b.parentId || hasUsableOrbit(b)) continue;
    const clear = visualBinaryHelioPlanetClearanceSep(
      b,
      sizeMode,
      bodies,
      helioScale,
    );
    if (clear > max) max = clear;
  }
  return max;
}

function tanHalfFovY(fovYDeg: number): number {
  const halfRad = ((fovYDeg * Math.PI) / 180) / 2;
  return Math.tan(halfRad);
}

/**
 * Star diameter as a fraction of vertical FOV at idle distance:
 * fill = starVis / (dist * tan(fovY/2)).
 */
export function starIdleFill(
  starVis: number,
  dist: number,
  fovYDeg: number = SCHEMATIC_FIT_FOV_Y_DEG,
): number {
  const tanHalf = tanHalfFovY(fovYDeg);
  if (!(starVis > 0) || !(dist > 1e-9) || !(tanHalf > 1e-9)) return 0;
  return starVis / (dist * tanHalf);
}

/**
 * Schematic-only orbit display compress ∈ (0,1] for wide/sparse systems.
 * Caller must gate on sizeMode==="schematic" and non-home (Sol → always 1).
 *
 * Pure formula — no per-body sizeTiers magic / no hardcoding host ids.
 */
export function schematicOrbitFitScale(
  bodies: readonly Body[],
  helioScale: number,
  fovYDeg: number = SCHEMATIC_FIT_FOV_Y_DEG,
): number {
  const star =
    bodies.find((b) => b.kind === "star" && !b.parentId) ??
    bodies.find((b) => b.kind === "star");
  if (!star) return 1;

  const starVis = visualRadius(star, "schematic", bodies);
  if (!(starVis > 0) || !Number.isFinite(starVis)) return 1;

  const hs = helioScale > 0 && Number.isFinite(helioScale) ? helioScale : 1;
  const extent0 = schematicFramingExtent(bodies, hs, "schematic");
  if (!(extent0 > 1e-9) || !Number.isFinite(extent0)) return 1;

  const dist0 = idleCameraDistance(extent0);
  const fill0 = starIdleFill(starVis, dist0, fovYDeg);
  if (fill0 >= STAR_IDLE_FILL_MIN) return 1;

  const tanHalf = tanHalfFovY(fovYDeg);
  const targetDist = starVis / (STAR_IDLE_FILL_TARGET * tanHalf);
  if (!(targetDist > 1e-9) || !Number.isFinite(targetDist)) return 1;

  // Want idleCameraDistance(extent0 * c) <= targetDist.
  // When targetDist < LEGACY: need extent0 * c * PAD <= targetDist.
  let c = 1;
  if (targetDist < IDLE_CAMERA_DIST_LEGACY - 1e-12) {
    c = targetDist / (extent0 * IDLE_EXTENT_PAD);
  }
  if (!(c > 0) || !Number.isFinite(c)) return 1;
  c = Math.min(1, Math.max(SCHEMATIC_FIT_MIN, c));

  // Always apply clamped compress when fill is under STAR_IDLE_FILL_MIN.
  // Even if idle stays at the legacy cap (inflated compact-hot hosts),
  // shrinking display orbits/companion seps still improves star/orbit ratio.
  return c;
}

/**
 * Idle distance after schematic fit. Optional soft star floor when fit
 * engaged the compact (below-legacy) branch and fill would still sit under
 * {@link STAR_IDLE_FILL_MIN}.
 */
export function schematicIdleCameraDistance(
  extentFitted: number,
  starVis: number,
  fitScale: number,
  fovYDeg: number = SCHEMATIC_FIT_FOV_Y_DEG,
): number {
  let dist = idleCameraDistance(extentFitted);
  if (!(fitScale < 1 - 1e-12)) return dist;
  // Only when compress already pulled onto the compact pad path.
  if (!(extentFitted * IDLE_EXTENT_PAD < IDLE_CAMERA_DIST_LEGACY - 1e-9)) {
    return dist;
  }
  const tanHalf = tanHalfFovY(fovYDeg);
  if (!(starVis > 0) || !(tanHalf > 1e-9)) return dist;
  const starFloorDist = starVis / (STAR_IDLE_FILL_MIN * tanHalf);
  if (!(starFloorDist > 1e-9) || !Number.isFinite(starFloorDist)) return dist;
  return Math.min(dist, starFloorDist);
}
