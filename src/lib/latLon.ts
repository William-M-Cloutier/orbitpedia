import * as THREE from "three";

/**
 * Convert geographic lat/lon (degrees) to a local unit-sphere position matching
 * Three.js SphereGeometry UV + typical equirectangular marquee maps
 * (u=0 at −X / antimeridian; u=0.5 / +X ≈ lon 0°).
 *
 * +Y is north. Coordinates are geographic only — not orbital elements.
 */
export function latLonToLocal(
  latDeg: number,
  lonDeg: number,
  radius = 1,
): THREE.Vector3 {
  const phi = ((90 - latDeg) * Math.PI) / 180;
  const theta = ((lonDeg + 180) * Math.PI) / 180;
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return new THREE.Vector3(x, y, z);
}

/** Format geographic latitude for Facts UI. */
export function formatLatDeg(latDeg: number): string {
  const abs = Math.abs(latDeg);
  const hemi = latDeg >= 0 ? "N" : "S";
  return `${abs.toFixed(4)}° ${hemi}`;
}

/** Format geographic longitude for Facts UI (east-positive). */
export function formatLonDeg(lonDeg: number): string {
  const abs = Math.abs(lonDeg);
  const hemi = lonDeg >= 0 ? "E" : "W";
  return `${abs.toFixed(4)}° ${hemi}`;
}
