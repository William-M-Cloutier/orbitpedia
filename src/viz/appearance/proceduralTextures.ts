import * as THREE from "three";
import type { SurfaceFamily } from "./surfaceFamily";

const TEX_SIZE = 64;

/** Tiny deterministic hash → [0,1). */
function hash2(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a * (1 - sx) * (1 - sy) + b * sx * (1 - sy) + c * (1 - sx) * sy + d * sx * sy;
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 19);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

function sampleFamily(
  family: SurfaceFamily,
  u: number,
  v: number,
  _x: number,
  _y: number,
): number {
  switch (family) {
    case "gas": {
      // Soft latitude bands + light longitudinal noise (readable, not striped neon).
      const bands =
        0.72 + 0.18 * Math.sin(v * Math.PI * 8 + fbm(u * 2.5, v * 1.5, 3, 2) * 0.9);
      const swirl = 0.05 * fbm(u * 5, v * 3, 11, 2);
      return Math.min(1, Math.max(0.55, bands + swirl));
    }
    case "ice": {
      // Pale frost with gentle mottling — keep albedo high so catalog cyan/white holds.
      const n = fbm(u * 3.5, v * 3.5, 7, 2);
      return Math.min(1, Math.max(0.7, 0.82 + 0.18 * n));
    }
    case "star": {
      // Soft granulation; stay bright so MeshBasic host stars read cleanly.
      const g = fbm(u * 6, v * 6, 13, 3);
      return Math.min(1, Math.max(0.55, 0.7 + 0.3 * g));
    }
    case "rocky":
    default: {
      // Light noise only — catalog color must dominate (Earth #6B93D6 stays
      // blue-ish, not mottled neon / alien green under yellow sun light).
      const n = fbm(u * 5, v * 5, 2, 2);
      return Math.min(1, Math.max(0.78, 0.88 + 0.12 * n));
    }
  }
}

function buildDataTexture(family: SurfaceFamily): THREE.DataTexture {
  const size = TEX_SIZE;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = sampleFamily(family, u, v, x, y);
      const c = Math.round(n * 255);
      const i = (y * size + x) * 4;
      data[i] = c;
      data[i + 1] = c;
      data[i + 2] = c;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  // Grayscale modulation map — leave linear so midtones don't crush/shift hue
  // when multiplied by catalog color under warm sun lighting.
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const cache = new Map<SurfaceFamily, THREE.DataTexture>();

/** Shared grayscale noise map per family — lean, created once. */
export function proceduralMap(family: SurfaceFamily): THREE.DataTexture {
  let tex = cache.get(family);
  if (!tex) {
    tex = buildDataTexture(family);
    cache.set(family, tex);
  }
  return tex;
}
