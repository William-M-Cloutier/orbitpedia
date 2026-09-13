import * as THREE from "three";

/**
 * Shared irregular small-body meshes (asteroids / comets).
 * Unit-radius displaced icospheres — BodyMesh scales by visualRadius.
 * Few seeded variants (id hash % N) so dense catalogs stay lean.
 */

const VARIANT_COUNT = 8;
/** detail 2 ≈ 320 tris — lumpy enough, cheap for hundreds of instances. */
const ICO_DETAIL = 2;

const cache: Array<THREE.BufferGeometry | undefined> = new Array(VARIANT_COUNT);

/** FNV-1a → unsigned; stable across sessions. */
export function hashBodyId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hash3(x: number, y: number, z: number, seed: number): number {
  const n =
    Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453;
  return n - Math.floor(n);
}

function valueNoise3(
  x: number,
  y: number,
  z: number,
  seed: number,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  let sum = 0;
  for (let dz = 0; dz <= 1; dz++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const w =
          (dx ? sx : 1 - sx) * (dy ? sy : 1 - sy) * (dz ? sz : 1 - sz);
        sum += w * hash3(x0 + dx, y0 + dy, z0 + dz, seed);
      }
    }
  }
  return sum;
}

function fbm3(
  x: number,
  y: number,
  z: number,
  seed: number,
  octaves: number,
): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise3(x * freq, y * freq, z * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

function buildVariant(seed: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, ICO_DETAIL);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();

  // Mild triaxial stretch so variants read as different rocks, not same lump.
  const sx = 1 + 0.18 * ((seed % 7) / 7 - 0.45);
  const sy = 1 + 0.14 * (((seed * 3) % 5) / 5 - 0.4);
  const sz = 1 + 0.16 * (((seed * 5) % 9) / 9 - 0.42);

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.x *= sx;
    v.y *= sy;
    v.z *= sz;
    n.copy(v).normalize();
    const lump =
      0.14 * fbm3(n.x * 1.4, n.y * 1.4, n.z * 1.4, seed, 3) +
      0.07 * fbm3(n.x * 3.2, n.y * 3.2, n.z * 3.2, seed + 3, 2);
    // Shallow crater-ish dents (darker basins when lit).
    const crater = fbm3(n.x * 5.5, n.y * 5.5, n.z * 5.5, seed + 11, 2);
    const dent = crater > 0.62 ? -0.045 * (crater - 0.62) * 4 : 0;
    v.copy(n).multiplyScalar(1 + lump * 0.55 - 0.04 + dent);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  // Shared across mounts — never dispose from a single mesh unmount.
  geo.userData.sharedSmallBody = true;
  return geo;
}

/**
 * Unit-radius lumpy rock geometry for asteroid/comet BodyMesh.
 * Fail-open: always returns a geometry (builds on first use per variant).
 */
export function getSmallBodyGeometry(bodyId: string): THREE.BufferGeometry {
  const variant = hashBodyId(bodyId || "rock") % VARIANT_COUNT;
  let g = cache[variant];
  if (!g) {
    g = buildVariant(variant * 997 + 13);
    cache[variant] = g;
  }
  return g;
}

/** Test helper — how many variants are warmed. */
export function smallBodyGeometryCacheSize(): number {
  return cache.filter(Boolean).length;
}
