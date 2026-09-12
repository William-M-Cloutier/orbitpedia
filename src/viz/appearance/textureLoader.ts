"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import { lookupTextureId } from "./textureRegistry";

/**
 * Shared TextureLoader + promise cache.
 * Lazy: fetch starts when a body with textureId is in-scene (near) or focused.
 * Fail-open: errors / unknown keys resolve to null → procedural.
 */
const loader = new THREE.TextureLoader();
const inflight = new Map<string, Promise<THREE.Texture | null>>();
const resolved = new Map<string, THREE.Texture | null>();

function configureMap(tex: THREE.Texture): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Request a registry map by kebab key. Never throws — null on miss/fail. */
export function requestRegistryTexture(
  textureId: string | undefined | null,
): Promise<THREE.Texture | null> {
  if (!textureId) return Promise.resolve(null);
  if (resolved.has(textureId)) {
    return Promise.resolve(resolved.get(textureId) ?? null);
  }
  const existing = inflight.get(textureId);
  if (existing) return existing;

  const entry = lookupTextureId(textureId);
  if (!entry) {
    resolved.set(textureId, null);
    return Promise.resolve(null);
  }

  const p = new Promise<THREE.Texture | null>((resolve) => {
    loader.load(
      entry.src,
      (tex) => {
        const ready = configureMap(tex);
        resolved.set(textureId, ready);
        inflight.delete(textureId);
        resolve(ready);
      },
      undefined,
      () => {
        resolved.set(textureId, null);
        inflight.delete(textureId);
        resolve(null);
      },
    );
  });
  inflight.set(textureId, p);
  return p;
}

/**
 * React hook: load registry map when `active` (focused or body near/in-scene).
 * Returns null until ready or on failure (caller keeps procedural).
 */
export function useRegistryTexture(
  textureId: string | undefined | null,
  active: boolean,
): THREE.Texture | null {
  const [map, setMap] = useState<THREE.Texture | null>(() => {
    if (!textureId || !active) return null;
    return resolved.get(textureId) ?? null;
  });

  useEffect(() => {
    if (!active || !textureId) {
      setMap(null);
      return;
    }
    let alive = true;
    const cached = resolved.get(textureId);
    if (cached !== undefined) {
      setMap(cached);
      return;
    }
    requestRegistryTexture(textureId).then((tex) => {
      if (alive) setMap(tex);
    });
    return () => {
      alive = false;
    };
  }, [textureId, active]);

  return map;
}
