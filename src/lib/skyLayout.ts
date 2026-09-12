/**
 * Heliocentric ICRS → galactic rectangular layout helpers for the Systems map.
 *
 * Equatorial→galactic rotation: Hipparcos / IAU J2000 (Murray 1989 matrix as
 * used by ESA Hipparcos and common astronomy libs). Frame: galactic center at
 * origin, +X toward the center from the Sun's side (Sol at ≈ (−R₀, 0, 0)),
 * +Y in the direction of Galactic rotation, +Z toward the NGP.
 *
 * World units: 1 = 1 light-year (proportional). Schematic equalizes distance
 * but keeps sky direction. Never invents RA/Dec.
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

/** Schematic ring radius around Sol (ly / world units). */
export const SCHEMATIC_R = 280;

/** Gutter for systems missing sky coords (below the disk plane in map Y). */
export const UNKNOWN_GUTTER_Y = SOL_GAL.y + MW_DISK_R_LY * 0.55;
export const UNKNOWN_GUTTER_X0 = SOL_GAL.x - 900;
export const UNKNOWN_GUTTER_STEP = 56;

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
 * Place one system in galactic-plane map coords.
 * Sol/home → Sol's conventional galactic position (no RA/Dec required).
 * Missing coords → gutter (caller assigns horizontal index).
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
    // Direction from a unit-distance vector; equalized ring around Sol.
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
