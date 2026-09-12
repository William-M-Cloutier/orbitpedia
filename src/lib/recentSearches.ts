/** Session-only recent Explore targets from Search / typeahead (max 5). */

export type RecentSearchItem = {
  label: string;
  href: string;
  kind: "system" | "body";
};

const KEY = "orbitpedia.recentSearches";
const MAX = 5;

export function loadRecentSearches(): RecentSearchItem[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is RecentSearchItem =>
          !!x &&
          typeof x === "object" &&
          typeof (x as RecentSearchItem).label === "string" &&
          typeof (x as RecentSearchItem).href === "string" &&
          ((x as RecentSearchItem).kind === "system" ||
            (x as RecentSearchItem).kind === "body"),
      )
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function pushRecentSearch(item: RecentSearchItem): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const prev = loadRecentSearches().filter((x) => x.href !== item.href);
    const next = [item, ...prev].slice(0, MAX);
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}
