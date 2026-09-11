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
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 32; i++) {
    const f = E - e * Math.sin(E) - M;
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

/** Heliocentric ecliptic XYZ in AU at mean anomaly (degrees). */
export function positionAtMa(
  el: OrbitalElements,
  maDeg?: number,
): [number, number, number] {
  const M = degToRad(maDeg ?? el.maDeg);
  const E = solveKepler(M, el.e);
  const nu = trueAnomaly(E, el.e);
  const r = radiusFromAnomaly(el.aAu, el.e, nu);

  const xOrb = r * Math.cos(nu);
  const yOrb = r * Math.sin(nu);

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

/** Sample ellipse points in ecliptic frame (AU). */
export function sampleOrbit(
  el: OrbitalElements,
  n = 128,
): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const ma = (360 * i) / n;
    pts.push(positionAtMa(el, ma));
  }
  return pts;
}
