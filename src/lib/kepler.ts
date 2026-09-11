/** Keplerian helpers — angles in radians unless noted *Deg. */

const DEG = Math.PI / 180;

export function degToRad(d: number): number {
  return d * DEG;
}

export function radToDeg(r: number): number {
  return r / DEG;
}

/** Solve Kepler's equation M = E - e sin E for eccentric anomaly E. */
export function solveKepler(M: number, e: number, tol = 1e-10): number {
  // Wrap M into (-π, π] so Newton starts near the physical root (large simDays).
  let m = M % (Math.PI * 2);
  if (m > Math.PI) m -= Math.PI * 2;
  if (m < -Math.PI) m += Math.PI * 2;
  let E = e < 0.8 ? m : Math.PI;
  for (let i = 0; i < 32; i++) {
    const f = E - e * Math.sin(E) - m;
    const fp = 1 - e * Math.cos(E);
    const d = f / fp;
    E -= d;
    if (Math.abs(d) < tol) break;
  }
  return E;
}

export function trueAnomaly(E: number, e: number): number {
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  return Math.atan2(Math.sqrt(1 - e * e) * sinE, cosE - e);
}

export function radiusFromAnomaly(a: number, e: number, nu: number): number {
  return (a * (1 - e * e)) / (1 + e * Math.cos(nu));
}

/** Sidereal / Gaussian year (days) for heliocentric Kepler-3 mean period. */
export const GAUSS_YEAR_D = 365.256363;

/** Period (days) from semi-major axis (AU) via Kepler's 3rd law (Sun-centered). */
export function periodFromA(aAu: number): number {
  return Math.pow(aAu, 1.5) * GAUSS_YEAR_D;
}

export type OrbitalElements = {
  aAu: number;
  e: number;
  iDeg: number;
  omDeg: number;
  wDeg: number;
  maDeg: number;
};

/** Perifocal XY → ecliptic XYZ (AU) via Ω, i, ω. */
function perifocalToEcliptic(
  el: OrbitalElements,
  xOrb: number,
  yOrb: number,
): [number, number, number] {
  const i = degToRad(el.iDeg);
  const om = degToRad(el.omDeg);
  const w = degToRad(el.wDeg);

  const cosOm = Math.cos(om);
  const sinOm = Math.sin(om);
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);

  const x =
    (cosOm * cosW - sinOm * sinW * cosI) * xOrb +
    (-cosOm * sinW - sinOm * cosW * cosI) * yOrb;
  const y =
    (sinOm * cosW + cosOm * sinW * cosI) * xOrb +
    (-sinOm * sinW + cosOm * cosW * cosI) * yOrb;
  const z = sinW * sinI * xOrb + cosW * sinI * yOrb;

  return [x, y, z];
}

/** Ecliptic XYZ in AU at true anomaly (degrees). */
export function positionAtTrueAnomaly(
  el: OrbitalElements,
  nuDeg: number,
): [number, number, number] {
  const nu = degToRad(nuDeg);
  const r = radiusFromAnomaly(el.aAu, el.e, nu);
  return perifocalToEcliptic(el, r * Math.cos(nu), r * Math.sin(nu));
}

/** Ecliptic XYZ in AU at mean anomaly (degrees). */
export function positionAtMa(
  el: OrbitalElements,
  maDeg?: number,
): [number, number, number] {
  const M = degToRad(maDeg ?? el.maDeg);
  const E = solveKepler(M, el.e);
  const nu = trueAnomaly(E, el.e);
  const r = radiusFromAnomaly(el.aAu, el.e, nu);
  return perifocalToEcliptic(el, r * Math.cos(nu), r * Math.sin(nu));
}

/**
 * Sample ellipse points in ecliptic frame (AU).
 * Uniform in true anomaly so eccentric orbits (e.g. Pluto) keep tight chords —
 * MA-uniform sampling left bodies visibly off the drawn polyline when zoomed.
 */
export function sampleOrbit(
  el: OrbitalElements,
  n = 192,
): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const nu = (360 * i) / n;
    pts.push(positionAtTrueAnomaly(el, nu));
  }
  return pts;
}

/** Unit orbital angular-momentum direction from Kepler i, Ω (ecliptic). */
export function orbitalNormalFromElements(el: Pick<OrbitalElements, "iDeg" | "omDeg">): [number, number, number] {
  const i = degToRad(el.iDeg);
  const om = degToRad(el.omDeg);
  const si = Math.sin(i);
  return [si * Math.sin(om), -si * Math.cos(om), Math.cos(i)];
}

/**
 * Mean primary-plane normal for a system (equal weight). Near-zero → ecliptic Z.
 * Used so Explore is face-on for edge-on archive systems without rewriting cards.
 */
export function meanOrbitalNormal(
  elements: ReadonlyArray<Pick<OrbitalElements, "iDeg" | "omDeg">>,
): [number, number, number] {
  if (!elements.length) return [0, 0, 1];
  let x = 0, y = 0, z = 0;
  for (const el of elements) {
    const n = orbitalNormalFromElements(el);
    x += n[0]; y += n[1]; z += n[2];
  }
  const len = Math.hypot(x, y, z);
  if (!(len > 1e-9)) return [0, 0, 1];
  return [x / len, y / len, z / len];
}

export type FaceOnRotation = {
  /** Row-major 3×3: v' = R · v in ecliptic XYZ. */
  m: readonly [number, number, number, number, number, number, number, number, number];
};

/** Identity face-on (already ecliptic-aligned systems). */
export const FACE_ON_IDENTITY: FaceOnRotation = {
  m: [1, 0, 0, 0, 1, 0, 0, 0, 1],
};

/**
 * Rotation that maps `normal` → ecliptic +Z so the system plane is face-on
 * in Explore (Sol stays near-identity; transit-edge-on systems tip flat).
 */
export function faceOnRotationFromNormal(
  normal: readonly [number, number, number],
): FaceOnRotation {
  const [nx, ny, nz] = normal;
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 1e-9)) return FACE_ON_IDENTITY;
  const ax = nx / len, ay = ny / len, az = nz / len;
  // Already aligned with +Z?
  if (ax * ax + ay * ay < 1e-12 && az > 0) return FACE_ON_IDENTITY;
  // Aligned with -Z: 180° about X
  if (ax * ax + ay * ay < 1e-12 && az < 0) {
    return { m: [1, 0, 0, 0, -1, 0, 0, 0, -1] };
  }
  // Rodrigues: rotate `a` onto `z=(0,0,1)`.
  // k = a × z (axis), c = a·z, s = |k|
  const kx = ay; // a × z = (ay, -ax, 0)
  const ky = -ax;
  const kz = 0;
  const kLen = Math.hypot(kx, ky, kz);
  const cx = kx / kLen, cy = ky / kLen, cz = kz / kLen;
  const c = az; // a·z
  const s = kLen; // |a×z| = sin(theta) since |a|=|z|=1
  // R = I cosθ + (k)(k)^T (1-cosθ) + K sinθ  with cosθ=c, sinθ=s
  // Actually standard Rodrigues uses angle θ with cosθ=a·z, sinθ=|a×z|
  const cos = c;
  const sin = s;
  const C = 1 - cos;
  const m0 = cos + cx * cx * C;
  const m1 = cx * cy * C - cz * sin;
  const m2 = cx * cz * C + cy * sin;
  const m3 = cy * cx * C + cz * sin;
  const m4 = cos + cy * cy * C;
  const m5 = cy * cz * C - cx * sin;
  const m6 = cz * cx * C - cy * sin;
  const m7 = cz * cy * C + cx * sin;
  const m8 = cos + cz * cz * C;
  return { m: [m0, m1, m2, m3, m4, m5, m6, m7, m8] };
}

export function faceOnRotateEcliptic(
  rot: FaceOnRotation,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const m = rot.m;
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
}
