/**
 * Satellite mesh / OrbitLine LOD (system-agnostic).
 *
 * Guard: no all-on GPU at open when catalogs densify — procedural-only,
 * focus/LOD. First slice (N≤5) stays full/simple; dense path (N >
 * {@link SAT_FULL_MESH_CAP}) keeps focused + highest-priority ranks on mesh
 * and demotes the rest to Points impostors. OrbitLine: focused always; all
 * lines when N≤cap; else focused + ranked neighbors only.
 */

export const SAT_FULL_MESH_CAP = 24;

/** Scene units: camera closer than this → full procedural (when mesh-eligible). */
export const SAT_LOD_NEAR_DIST = 4;

/** Scene units: beyond this → Points impostor (unless focused). */
export const SAT_LOD_FAR_DIST = 14;

export type SatLodTier = "full" | "simple" | "points";

export type SatLodBody = {
  id: string;
  orbit?: { aKm?: number | null } | null;
};

/**
 * Resolve mesh LOD tier (cheap; call from useFrame with camera distance).
 *
 * - Focused → always full procedural box+panels.
 * - Dense (satCount > cap) and meshRank ≥ cap → Points.
 * - Far → Points; mid → simple octahedron; near → full.
 */
export function resolveSatLodTier(opts: {
  focused: boolean;
  satCount: number;
  /** 0 = highest priority (focused or closest-by-aKm). */
  meshRank: number;
  distToCamera: number;
  cap?: number;
  nearDist?: number;
  farDist?: number;
}): SatLodTier {
  const cap = opts.cap ?? SAT_FULL_MESH_CAP;
  const near = opts.nearDist ?? SAT_LOD_NEAR_DIST;
  const far = opts.farDist ?? SAT_LOD_FAR_DIST;
  if (opts.focused) return "full";
  if (opts.satCount > cap && opts.meshRank >= cap) return "points";
  const d = opts.distToCamera;
  if (!(d >= 0) || d > far) return "points";
  if (d > near) return "simple";
  return "full";
}

/**
 * Stable mesh-priority ranks: focused → 0; others by ascending aKm (LEO
 * first), then id. When N ≤ {@link SAT_FULL_MESH_CAP} every sat gets rank < cap.
 */
export function assignSatMeshRanks(
  sats: ReadonlyArray<SatLodBody>,
  focusId?: string | null,
): Map<string, number> {
  const ranks = new Map<string, number>();
  const focused =
    focusId && sats.some((s) => s.id === focusId) ? focusId : null;
  const rest = sats
    .filter((s) => s.id !== focused)
    .slice()
    .sort((a, b) => {
      const ak = a.orbit?.aKm ?? Number.POSITIVE_INFINITY;
      const bk = b.orbit?.aKm ?? Number.POSITIVE_INFINITY;
      if (ak !== bk) return ak - bk;
      return a.id.localeCompare(b.id);
    });
  let i = 0;
  if (focused) {
    ranks.set(focused, 0);
    i = 1;
  }
  for (const s of rest) ranks.set(s.id, i++);
  return ranks;
}

/**
 * Geocentric OrbitLine policy:
 * - Focused always.
 * - When geoSatCount ≤ cap: draw all.
 * - When denser: focused + neighbors with meshRank < cap (skip unfocused beyond).
 */
export function shouldDrawGeocentricOrbitLine(opts: {
  focused: boolean;
  geoSatCount: number;
  meshRank: number;
  cap?: number;
}): boolean {
  if (opts.focused) return true;
  const cap = opts.cap ?? SAT_FULL_MESH_CAP;
  if (opts.geoSatCount <= cap) return true;
  return opts.meshRank < cap;
}
