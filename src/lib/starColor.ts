/**
 * Approximate map-node fill from Harvard spectral class letter.
 * Curated systems should prefer Body.color; archive index stubs use this.
 */
const SPECTRAL_COLORS: Record<string, string> = {
  O: "#9BB0FF",
  B: "#AABFFF",
  A: "#CAD7FF",
  F: "#F8F7FF",
  G: "#FDB813",
  K: "#FFAA6B",
  M: "#FF6B4A",
};

/** G-like fallback when a single solid node needs a color. */
const FALLBACK = "#FDB813";

/**
 * Map pie segment when spectral type is missing / non-letter (Other).
 * Distinct from G so unknown companions are not painted Sun-yellow.
 */
export const STAR_COLOR_UNKNOWN = "#94a3b8";

export function starColorFromSpectralType(
  spectralType: string | undefined | null,
): string {
  if (!spectralType) return FALLBACK;
  const letter = spectralType.trim().charAt(0).toUpperCase();
  return SPECTRAL_COLORS[letter] ?? FALLBACK;
}

/**
 * Map multi-star wedge color: missing / non Harvard-letter → Other slate.
 * Do not invent spectral class — unknown stays visibly Other.
 */
export function starColorForMapSegment(
  spectralType: string | undefined | null,
): string {
  if (!spectralType) return STAR_COLOR_UNKNOWN;
  const letter = spectralType.trim().charAt(0).toUpperCase();
  return SPECTRAL_COLORS[letter] ?? STAR_COLOR_UNKNOWN;
}
