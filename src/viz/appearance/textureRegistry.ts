/**
 * Marquee Sol texture registry.
 *
 * Body cards set `appearance.textureId` to a kebab-case key here.
 * Keys only on cards — never URLs, paths, or bytes.
 *
 * Fail-open: missing key or failed load → procedural material.
 *
 * Guard caps: ≤512KB/file, ≤2048², ≤20 Sol bodies, ≤8MB pack, lazy load.
 * (Code Guard ACK: William+Lead bump from ≤12/≤6MB for major-moon pack.)
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
    "venus-marquee": {
      id: "venus-marquee",
      src: "/textures/venus-marquee.webp",
      credit: "NASA/JPL Magellan radar mosaic",
    },
    "saturn-marquee": {
      id: "saturn-marquee",
      src: "/textures/saturn-marquee.webp",
      credit: "NASA/Cassini-derived globe (Solar System Scope, CC BY 4.0)",
    },
    "uranus-marquee": {
      id: "uranus-marquee",
      src: "/textures/uranus-marquee.webp",
      credit: "NASA/Voyager-derived (Solar System Scope, CC BY 4.0)",
    },
    "neptune-marquee": {
      id: "neptune-marquee",
      src: "/textures/neptune-marquee.webp",
      credit: "NASA/Voyager-derived (Solar System Scope, CC BY 4.0)",
    },
    "sun-marquee": {
      id: "sun-marquee",
      src: "/textures/sun-marquee.webp",
      credit: "NASA SDO-derived (Solar System Scope, CC BY 4.0)",
    },
    "mercury-marquee": {
      id: "mercury-marquee",
      src: "/textures/mercury-marquee.webp",
      credit: "NASA/MESSENGER-derived (Solar System Scope, CC BY 4.0)",
    },
    "pluto-marquee": {
      id: "pluto-marquee",
      src: "/textures/pluto-marquee.webp",
      credit: "NASA/JHUAPL/SwRI New Horizons PIA19956",
    },
    "ceres-marquee": {
      id: "ceres-marquee",
      src: "/textures/ceres-marquee.webp",
      credit: "NASA/Dawn-derived (Solar System Scope, CC BY 4.0)",
    },
    "io-marquee": {
      id: "io-marquee",
      src: "/textures/io-marquee.webp",
      credit: "NASA/JPL/USGS Voyager-Galileo mosaic (cylindrical)",
    },
    "europa-marquee": {
      id: "europa-marquee",
      src: "/textures/europa-marquee.webp",
      credit: "NASA/Juno-Voyager-Galileo mosaic (cylindrical)",
    },
    "ganymede-marquee": {
      id: "ganymede-marquee",
      src: "/textures/ganymede-marquee.webp",
      credit: "NASA/JPL/USGS Voyager-Galileo mosaic (cylindrical)",
    },
    "callisto-marquee": {
      id: "callisto-marquee",
      src: "/textures/callisto-marquee.webp",
      credit: "NASA/Voyager-Galileo mosaic (cylindrical)",
    },
    "titan-marquee": {
      id: "titan-marquee",
      src: "/textures/titan-marquee.webp",
      credit: "NASA/JPL-Caltech/SSI Cassini PIA19658",
    },
    "enceladus-marquee": {
      id: "enceladus-marquee",
      src: "/textures/enceladus-marquee.webp",
      credit: "NASA/JPL/SSI Cassini PIA08417",
    },
    "triton-marquee": {
      id: "triton-marquee",
      src: "/textures/triton-marquee.webp",
      credit: "NASA/Voyager mosaic (cylindrical)",
    },
    "charon-marquee": {
      id: "charon-marquee",
      src: "/textures/charon-marquee.webp",
      credit: "NASA/JHUAPL/SwRI New Horizons mosaic (cylindrical)",
    },
  });

export function lookupTextureId(
  textureId: string | undefined | null,
): TextureRegistryEntry | undefined {
  if (!textureId) return undefined;
  return TEXTURE_REGISTRY[textureId];
}
