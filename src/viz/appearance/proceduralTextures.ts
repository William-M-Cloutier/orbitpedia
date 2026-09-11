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
  x: number,
  y: number,
): number {
  switch (family) {
    case "gas": {
      // Soft latitude bands + light longitudinal noise.
      const bands = 0.55 + 0.35 * Math.sin(v * Math.PI * 10 + fbm(u * 3, v * 2, 3, 2) * 1.2);
      const swirl = 0.08 * fbm(u * 6, v * 4, 11, 3);
      return Math.min(1, Math.max(0.15, bands + swirl));
    }
    case "ice": {
      const n = fbm(u * 4, v * 4, 7, 3);
      return Math.min(1, Math.max(0.55, 0.72 + 0.28 * n));
    }
    case "star": {
      const g = fbm(u * 8, v * 8, 13, 4);
      return Math.min(1, Math.max(0.35, 0.55 + 0.45 * g));
    }
    case "rocky":
    default: {
      const n = fbm(u * 10, v * 10, 2, 4);
      const speck = hash2(x, y, 5) > 0.92 ? 0.25 : 0;
      return Math.min(1, Math.max(0.2, 0.35 + 0.5 * n + speck));
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
  tex.colorSpace = THREE.SRGBColorSpace;
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
