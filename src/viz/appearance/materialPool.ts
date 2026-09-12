import * as THREE from "three";
import type { Body } from "@/data/schema";
import {
  defaultFamilyColor,
  inferSurfaceFamily,
  type SurfaceFamily,
} from "./surfaceFamily";
import { proceduralMap } from "./proceduralTextures";

const pool = new Map<string, THREE.Material>();

/** Selection glow — readable but not a neon rim (was 0.45 + full-color emissive). */
const FOCUS_EMISSIVE_INTENSITY = 0.16;
/** Mix emissive toward black so the halo stays soft across all families. */
const FOCUS_EMISSIVE_MIX = 0.35;

function normalizeHex(color: string | undefined, family: SurfaceFamily): string {
  const raw = (color ?? defaultFamilyColor(family)).trim();
  if (!raw) return defaultFamilyColor(family);
  return raw.toLowerCase();
}

/** Soft selection emissive: catalog/highlight hue, heavily muted. */
function softEmissiveHex(hex: string): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(FOCUS_EMISSIVE_MIX);
  return `#${c.getHexString()}`;
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
    family === "ice" ? 0.42 : family === "gas" ? 0.55 : 0.78;
  const metalness = family === "ice" ? 0.08 : 0.03;
  return new THREE.MeshStandardMaterial({
    color: colorHex,
    map,
    roughness,
    metalness,
    emissive: focused ? softEmissiveHex(emissiveHex) : "#000000",
    emissiveIntensity: focused ? FOCUS_EMISSIVE_INTENSITY : 0,
  });
}

function buildMappedMaterial(
  family: SurfaceFamily,
  focused: boolean,
  emissiveHex: string,
  surfaceMap: THREE.Texture,
): THREE.Material {
  // Stars stay unlit so a registry map does not go dark (the star is the light).
  if (family === "star") {
    return new THREE.MeshBasicMaterial({
      color: "#ffffff",
      map: surfaceMap,
      toneMapped: true,
    });
  }
  // Color maps carry albedo — keep tint white so continents / bands read true.
  const roughness =
    family === "ice" ? 0.42 : family === "gas" ? 0.52 : 0.72;
  const metalness = family === "ice" ? 0.06 : 0.02;
  return new THREE.MeshStandardMaterial({
    color: "#ffffff",
    map: surfaceMap,
    roughness,
    metalness,
    emissive: focused ? softEmissiveHex(emissiveHex) : "#000000",
    emissiveIntensity: focused ? FOCUS_EMISSIVE_INTENSITY : 0,
  });
}

/**
 * Resolve mesh material for a body.
 *
 * Prefer a loaded registry map when present; otherwise procedural by family +
 * catalog color. Missing/failed maps → fail-open to procedural (never block).
 *
 * Shared pool keyed by family|color|focus|emissive|texId — lean.
 */
export function getBodyAppearanceMaterial(
  body: Pick<Body, "kind" | "facts" | "color" | "appearance">,
  focused: boolean,
  highlightColor?: string,
  surfaceMap?: THREE.Texture | null,
): THREE.Material {
  const family = inferSurfaceFamily(body);
  const colorHex = normalizeHex(body.color, family);
  const emissiveHex = normalizeHex(highlightColor ?? body.color, family);
  const textureId = body.appearance?.textureId;
  const useMap = Boolean(surfaceMap && textureId);

  const key = useMap
    ? `map|${textureId}|${family}|${focused ? 1 : 0}|${focused ? emissiveHex : ""}`
    : `${family}|${colorHex}|${focused ? 1 : 0}|${focused ? emissiveHex : ""}`;

  let mat = pool.get(key);
  if (!mat) {
    mat = useMap
      ? buildMappedMaterial(family, focused, emissiveHex, surfaceMap!)
      : buildProceduralMaterial(family, colorHex, focused, emissiveHex);
    pool.set(key, mat);
  }
  return mat;
}

/** Test / debug helper — pool size stays small (families × colors × focus). */
export function appearancePoolSize(): number {
  return pool.size;
}
