import * as THREE from "three";
import type { Body } from "@/data/schema";
import {
  defaultFamilyColor,
  inferSurfaceFamily,
  type SurfaceFamily,
} from "./surfaceFamily";
import { proceduralMap } from "./proceduralTextures";

const pool = new Map<string, THREE.Material>();

function normalizeHex(color: string | undefined, family: SurfaceFamily): string {
  const raw = (color ?? defaultFamilyColor(family)).trim();
  if (!raw) return defaultFamilyColor(family);
  return raw.toLowerCase();
}

function buildProceduralMaterial(
  family: SurfaceFamily,
  colorHex: string,
  focused: boolean,
  emissiveHex: string,
): THREE.Material {
  const map = proceduralMap(family);
  if (family === "star") {
    // Unlit + map so host stars stay bright/readable against the starfield.
    return new THREE.MeshBasicMaterial({
      color: colorHex,
      map,
      toneMapped: true,
    });
  }

  const roughness =
    family === "ice" ? 0.38 : family === "gas" ? 0.55 : 0.82;
  const metalness = family === "ice" ? 0.12 : 0.04;
  return new THREE.MeshStandardMaterial({
    color: colorHex,
    map,
    roughness,
    metalness,
    emissive: focused ? emissiveHex : "#000000",
    emissiveIntensity: focused ? 0.45 : 0,
  });
}

/**
 * Resolve mesh material for a body.
 *
 * This slice: procedural by family + catalog color only.
 * `appearance.textureId` is intentionally ignored for rendering (fail-open
 * forever when real maps land later — missing/failed maps never block Explore).
 *
 * Shared pool keyed by family|color|focus|emissive — lean, no per-mesh alloc.
 */
export function getBodyAppearanceMaterial(
  body: Pick<Body, "kind" | "facts" | "color">,
  focused: boolean,
  highlightColor?: string,
): THREE.Material {
  const family = inferSurfaceFamily(body);
  const colorHex = normalizeHex(body.color, family);
  const emissiveHex = normalizeHex(highlightColor ?? body.color, family);

  const key = `${family}|${colorHex}|${focused ? 1 : 0}|${focused ? emissiveHex : ""}`;
  let mat = pool.get(key);
  if (!mat) {
    mat = buildProceduralMaterial(family, colorHex, focused, emissiveHex);
    pool.set(key, mat);
  }
  return mat;
}

/** Test / debug helper — pool size stays small (families × colors × focus). */
export function appearancePoolSize(): number {
  return pool.size;
}
