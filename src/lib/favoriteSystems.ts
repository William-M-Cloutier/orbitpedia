/** User-driven favorite systems for the Systems map (localStorage). */

const KEY = "orbitpedia.favoriteSystems";

export function loadFavoriteSystemIds(defaultHomeId: string): Set<string> {
  if (typeof localStorage === "undefined") return new Set([defaultHomeId]);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set([defaultHomeId]);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set([defaultHomeId]);
    const ids = parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
    if (ids.length === 0) return new Set([defaultHomeId]);
    return new Set(ids);
  } catch {
    return new Set([defaultHomeId]);
  }
}

export function saveFavoriteSystemIds(ids: Set<string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore quota / private mode */
  }
}
