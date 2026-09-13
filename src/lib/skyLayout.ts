/**
 * Heliocentric ICRS → galactic rectangular layout helpers for the Systems map.
 *
 * Equatorial→galactic rotation: Hipparcos / IAU J2000 (Murray 1989 matrix as
 * used by ESA Hipparcos and common astronomy libs). Frame: galactic center at
 * origin, +X toward the center from the Sun's side (Sol at ≈ (−R₀, 0, 0)),
 * +Y in the direction of Galactic rotation, +Z toward the NGP.
 *
 * World units: 1 = 1 light-year (proportional). Schematic uses a golden-angle
 * sunflower around Sol (spread, not sky ring). Proportional uses true sky
 * distance. Never invents RA/Dec.
 */

export type SkyCoords = {
  raDeg?: number;
  decDeg?: number;
  distanceLy?: number;
  home?: boolean;
};

/** Light-years per kiloparsec. */
export const LY_PER_KPC = 3261.56;

/** Conventional Galactocentric radius of the Sun (kpc). */
export const SOL_R0_KPC = 8.2;

/** Sol in galactic rectangular coordinates (ly). */
export const SOL_GAL = {
  x: -SOL_R0_KPC * LY_PER_KPC,
  y: 0,
  z: 0,
} as const;

/** Approximate stellar disk radius used for the backdrop (kpc → ly). */
export const MW_DISK_R_LY = 15 * LY_PER_KPC;

/**
 * Legacy equalized sky-ring radius (unused by Schematic sunflower layout).
 * Kept for any callers still probing the old ring path in placeSystemSky.
 */
export const SCHEMATIC_R = 280;

/** Gutter for systems missing sky coords (below the disk plane in map Y). */
export const UNKNOWN_GUTTER_Y = SOL_GAL.y + MW_DISK_R_LY * 0.55;
export const UNKNOWN_GUTTER_X0 = SOL_GAL.x - 900;
export const UNKNOWN_GUTTER_STEP = 56;

/** Golden angle (radians) for sunflower / Vogel spiral layout. */
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Center-to-center target spacing for Schematic sunflower (world units). */
export const SUNFLOWER_MIN_SEP = 168;

/**
 * Golden-angle sunflower around an origin (Sol / SOL_GAL on the Systems map).
 * index 0 → origin; later indices spiral out as MIN_SEP * sqrt(i).
 * Y is slightly flattened (×0.72) to match the pre-MW map feel.
 */
export function placeSystemSunflower(
  index: number,
  originX: number = SOL_GAL.x,
  originY: number = SOL_GAL.y,
  minSep: number = SUNFLOWER_MIN_SEP,
): { x: number; y: number } {
  if (index <= 0) {
    return { x: originX, y: originY };
  }
  const ang = index * GOLDEN_ANGLE;
  const rad = minSep * Math.sqrt(index);
  return {
    x: originX + Math.cos(ang) * rad,
    y: originY + Math.sin(ang) * rad * 0.72,
  };
}


/**
 * Hipparcos / IAU equatorial (J2000) → galactic Cartesian rotation.
 * Rows map (x_eq, y_eq, z_eq) → (x_gal, y_gal, z_gal).
 */
const EQ_TO_GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.44482963, 0.7469822445],
  [-0.867666149, -0.1980763734, 0.4559837762],
] as const;

export function hasSkyCoords(
  n: SkyCoords,
): n is SkyCoords & { raDeg: number; decDeg: number } {
  return (
    typeof n.raDeg === "number" &&
    Number.isFinite(n.raDeg) &&
    typeof n.decDeg === "number" &&
    Number.isFinite(n.decDeg)
  );
}

/** Heliocentric galactic rectangular (ly) from ICRS degrees + distance. */
export function equatorialToGalactic(
  raDeg: number,
  decDeg: number,
  distLy: number,
): { x: number; y: number; z: number } {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const cosD = Math.cos(dec);
  const xe = distLy * cosD * Math.cos(ra);
  const ye = distLy * cosD * Math.sin(ra);
  const ze = distLy * Math.sin(dec);
  const m = EQ_TO_GAL;
  return {
    x: m[0][0]! * xe + m[0][1]! * ye + m[0][2]! * ze,
    y: m[1][0]! * xe + m[1][1]! * ye + m[1][2]! * ze,
    z: m[2][0]! * xe + m[2][1]! * ye + m[2][2]! * ze,
  };
}

export type LaidSky = {
  x: number;
  y: number;
  /** True when placed in the unknown-coords gutter. */
  unknownSky: boolean;
};

/**
 * Place one system in galactic-plane map coords (Proportional / legacy ring).
 * Sol/home → Sol's conventional galactic position (no RA/Dec required).
 * Missing coords → gutter (caller assigns horizontal index).
 * Schematic map layout should use placeSystemSunflower instead of the ring.
 */
export function placeSystemSky(
  n: SkyCoords,
  spacing: "schematic" | "proportional",
  gutterIndex: number,
): LaidSky {
  if (n.home) {
    return { x: SOL_GAL.x, y: SOL_GAL.y, unknownSky: false };
  }
  if (!hasSkyCoords(n)) {
    return {
      x: UNKNOWN_GUTTER_X0 + gutterIndex * UNKNOWN_GUTTER_STEP,
      y: UNKNOWN_GUTTER_Y,
      unknownSky: true,
    };
  }
  const dist =
    typeof n.distanceLy === "number" &&
    Number.isFinite(n.distanceLy) &&
    n.distanceLy > 0
      ? n.distanceLy
      : undefined;

  if (spacing === "schematic" || dist == null) {
    // Legacy equalized ring (Schematic map uses placeSystemSunflower).
    const h = equatorialToGalactic(n.raDeg, n.decDeg, 1);
    const hyp = Math.hypot(h.x, h.y, h.z) || 1;
    const lon = Math.atan2(h.y, h.x);
    const lat = Math.asin(Math.min(1, Math.max(-1, h.z / hyp)));
    const R = SCHEMATIC_R;
    return {
      x: SOL_GAL.x + R * Math.cos(lon),
      y: SOL_GAL.y + R * Math.sin(lon) + R * 0.32 * Math.sin(lat),
      unknownSky: false,
    };
  }

  const h = equatorialToGalactic(n.raDeg, n.decDeg, dist);
  // Project onto the galactic plane; tiny Z as vertical jitter only.
  return {
    x: SOL_GAL.x + h.x,
    y: SOL_GAL.y + h.y + h.z * 0.04,
    unknownSky: false,
  };
}

/**
 * Minimum center-to-center gap (world units) so map discs (NODE_R ≈ 10) do not
 * visually overlap. NODE_R*2 + generous pad.
 */
export const MIN_VISUAL_GAP = 56;

/**
 * Above this count, pairwise O(n²) separation is skipped — spatial-hash only.
 * Guards against bulk dumps (thousands) freezing the Systems map.
 */
export const SEPARATE_N_MAX = 80;

type SepPt = { x: number; y: number; home?: boolean; pinned?: boolean };

function isSepPinned(p: SepPt): boolean {
  return p.pinned === true || p.home === true;
}

function sepPushPair(
  a: SepPt,
  b: SepPt,
  minGap: number,
): boolean {
  const aPin = isSepPinned(a);
  const bPin = isSepPinned(b);
  if (aPin && bPin) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let dist = Math.hypot(dx, dy);
  if (dist >= minGap) return false;
  let ux: number;
  let uy: number;
  if (dist < 1e-9) {
    ux = 0;
    uy = 1;
    dist = 0;
  } else {
    ux = dx / dist;
    uy = dy / dist;
  }
  if (aPin) {
    b.x = a.x + ux * minGap;
    b.y = a.y + uy * minGap;
  } else if (bPin) {
    a.x = b.x - ux * minGap;
    a.y = b.y - uy * minGap;
  } else {
    const push = (minGap - dist) / 2;
    a.x -= ux * push;
    a.y -= uy * push;
    b.x += ux * push;
    b.y += uy * push;
  }
  return true;
}

/** Spatial-hash separation — O(n · k) neighbor checks; safe for thousands. */
function separateSkyNodesGrid(
  pts: SepPt[],
  minGap: number,
  pinX: number,
  pinY: number,
  iters: number,
): void {
  const pin = () => {
    for (const p of pts) {
      if (isSepPinned(p)) {
        p.x = pinX;
        p.y = pinY;
      }
    }
  };
  pin();
  const cell = Math.max(minGap, 1);
  const cellKey = (x: number, y: number) =>
    `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
  for (let iter = 0; iter < iters; iter++) {
    let moved = false;
    const bins = new Map<string, number[]>();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const k = cellKey(p.x, p.y);
      const list = bins.get(k);
      if (list) list.push(i);
      else bins.set(k, [i]);
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const cx = Math.floor(a.x / cell);
      const cy = Math.floor(a.y / cell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const idxs = bins.get(`${cx + dx}:${cy + dy}`);
          if (!idxs) continue;
          for (const j of idxs) {
            if (j <= i) continue;
            if (sepPushPair(a, pts[j]!, minGap)) moved = true;
          }
        }
      }
    }
    pin();
    if (!moved) break;
  }
}

/**
 * Push overlapping sky nodes apart without moving pinned hosts (Sol/home).
 * Only acts when distance < minGap — distant systems stay at true sky positions.
 * Push is along the existing offset; coincident pairs use +Y.
 * N > SEPARATE_N_MAX → spatial-hash / grid only (never O(n²) on thousands).
 */
export function separateSkyNodes(
  pts: Array<{ x: number; y: number; home?: boolean; pinned?: boolean }>,
  minGap: number = MIN_VISUAL_GAP,
  pinX: number = SOL_GAL.x,
  pinY: number = SOL_GAL.y,
  iters = 64,
): void {
  if (pts.length === 0) return;
  if (pts.length > SEPARATE_N_MAX) {
    separateSkyNodesGrid(pts, minGap, pinX, pinY, iters);
    return;
  }
  const pin = () => {
    for (const p of pts) {
      if (isSepPinned(p)) {
        p.x = pinX;
        p.y = pinY;
      }
    }
  };
  pin();
  for (let iter = 0; iter < iters; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        if (sepPushPair(pts[i]!, pts[j]!, minGap)) moved = true;
      }
    }
    pin();
    if (!moved) break;
  }
}

