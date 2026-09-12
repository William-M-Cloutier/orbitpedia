/** User-driven favorite systems for the Systems map (localStorage). */

const KEY = "orbitpedia.favoriteSystems";

/** Always include home — Favorites-only must never be an empty map. */
function withHome(ids: Iterable<string>, homeId: string): Set<string> {
  const next = new Set(ids);
  next.add(homeId);
  return next;
}

export function loadFavoriteSystemIds(defaultHomeId: string): Set<string> {
  if (typeof localStorage === "undefined") return new Set([defaultHomeId]);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set([defaultHomeId]);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set([defaultHomeId]);
    const ids = parsed.filter(
      (x): x is string => typeof x === "string" && x.length > 0,
    );
    return withHome(ids, defaultHomeId);
  } catch {
    return new Set([defaultHomeId]);
  }
}

export function saveFavoriteSystemIds(
  ids: Set<string>,
  homeId?: string,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    const toSave = homeId ? withHome(ids, homeId) : ids;
    localStorage.setItem(KEY, JSON.stringify([...toSave]));
  } catch {
    /* ignore quota / private mode */
  }
}
