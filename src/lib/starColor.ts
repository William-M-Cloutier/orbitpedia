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

const FALLBACK = "#FDB813";

export function starColorFromSpectralType(
  spectralType: string | undefined | null,
): string {
  if (!spectralType) return FALLBACK;
  const letter = spectralType.trim().charAt(0).toUpperCase();
  return SPECTRAL_COLORS[letter] ?? FALLBACK;
}
