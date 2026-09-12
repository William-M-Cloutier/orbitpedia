/**
 * Marquee Sol texture registry.
 *
 * Body cards set `appearance.textureId` to a kebab-case key here.
 * Keys only on cards — never URLs, paths, or bytes.
 *
 * Fail-open: missing key or failed load → procedural material.
 *
 * Guard caps: ≤512KB/file, ≤2048², ≤12 Sol bodies, ≤6MB pack, lazy load.
 */

export type TextureRegistryEntry = {
  id: string;
  /** Public path served from `public/` (TextureLoader URL). */
  src: string;
  /** Short credit for docs / debugging. */
  credit: string;
};

/** Seeded marquee maps — lean WebP under Guard caps. */
export const TEXTURE_REGISTRY: Readonly<Record<string, TextureRegistryEntry>> =
  Object.freeze({
    "earth-marquee": {
      id: "earth-marquee",
      src: "/textures/earth-marquee.webp",
      credit: "NASA SVS Blue Marble",
    },
    "moon-marquee": {
      id: "moon-marquee",
      src: "/textures/moon-marquee.webp",
      credit: "NASA lunar mosaic (Clementine-class)",
    },
    "mars-marquee": {
      id: "mars-marquee",
      src: "/textures/mars-marquee.webp",
      credit: "NASA/USGS Viking color mosaic derivative",
    },
    "jupiter-marquee": {
      id: "jupiter-marquee",
      src: "/textures/jupiter-marquee.webp",
      credit: "NASA/JPL/SSI Cassini PIA07782",
    },
  });

export function lookupTextureId(
  textureId: string | undefined | null,
): TextureRegistryEntry | undefined {
  if (!textureId) return undefined;
  return TEXTURE_REGISTRY[textureId];
}
