/**
 * Texture registry stub (FIRST SLICE — empty).
 *
 * Body cards may optionally set `appearance.textureId` to a key here.
 * Keys only — never URLs, paths, or bytes on the card.
 *
 * Fail-open: missing key or future failed load → procedural material.
 * No map asset pack in this slice (marquee Sol maps = later ticket).
 *
 * Guard caps (when maps land): ≤512KB/file, ≤2048², ≤12 Sol bodies,
 * ≤6MB pack total, lazy on focus.
 */

export type TextureRegistryEntry = {
  /** Reserved for a future loader / pack path. */
  id: string;
};

/** Empty stub — procedural path is the default for every body. */
export const TEXTURE_REGISTRY: Readonly<Record<string, TextureRegistryEntry>> =
  Object.freeze({});

export function lookupTextureId(
  textureId: string | undefined | null,
): TextureRegistryEntry | undefined {
  if (!textureId) return undefined;
  return TEXTURE_REGISTRY[textureId];
}
