import {
  CatalogSchema,
  hasUsableOrbit,
  type Body,
  type BodyKind,
  type Catalog,
  type System,
} from "./schema";
import { loadedBodies, loadedSystems } from "./catalog.generated";
import {
  peekSessionBody,
  peekSessionBodiesForSystem,
  peekSessionGraph,
  peekSessionSystem,
} from "./systemGraphSession";

/**
 * Assembled Store B catalog (v2). Body/system JSON is auto-registered via
 * scripts/generate-catalog-index.mjs (run after ingest / new cards).
 * Explore loads one system graph via getHomeSystemGraph() — never assume a
 * flat forever-all-bodies list.
 */
const raw = {
  version: 2 as const,
  systems: loadedSystems,
  bodies: loadedBodies,
};

export const catalog: Catalog = CatalogSchema.parse(raw);

export const systems: System[] = catalog.systems;
export const bodies: Body[] = catalog.bodies;

const systemById = new Map(systems.map((s) => [s.id, s]));
const bodyById = new Map(bodies.map((b) => [b.id, b]));

export function getSystem(id: string): System | undefined {
  return systemById.get(id) ?? peekSessionSystem(id);
}

/** All systems; home system first, then id order. For system map / Discover. */
export function listSystems(): System[] {
  return [...systems].sort((a, b) => {
    if (a.home === true && b.home !== true) return -1;
    if (b.home === true && a.home !== true) return 1;
    return a.id.localeCompare(b.id);
  });
}

export function getBody(id: string): Body | undefined {
  return bodyById.get(id) ?? peekSessionBody(id);
}

export function getBodiesForSystem(systemId: string): Body[] {
  const sys = systemById.get(systemId);
  if (sys) {
    const out: Body[] = [];
    for (const mid of sys.memberIds) {
      const b = bodyById.get(mid);
      if (b) out.push(b);
    }
    return out;
  }
  return peekSessionBodiesForSystem(systemId) ?? [];
}

export function getHomeSystem(): System {
  const home = systems.find((s) => s.home === true);
  if (!home) {
    throw new Error("Catalog v2 loud fail: no home system (home: true)");
  }
  return home;
}

export type SystemGraph = {
  system: System;
  bodies: Body[];
};

/** One system + its member body cards (default Explore load path). */
export function getSystemGraph(systemId: string): SystemGraph {
  // Curated Store B first.
  if (systemById.has(systemId)) {
    const system = systemById.get(systemId)!;
    const members = getBodiesForSystem(systemId);
    if (members.length === 0) {
      throw new Error(
        `Catalog v2 loud fail: system "${systemId}" has no resolvable members`,
      );
    }
    for (const b of members) {
      if (b.systemId !== systemId) {
        throw new Error(
          `Catalog v2 loud fail: body "${b.id}" systemId "${b.systemId}" ≠ graph "${systemId}"`,
        );
      }
    }
    return { system, bodies: members };
  }
  // Session-primed archive (or other lazy) graph.
  const session = peekSessionGraph(systemId);
  if (session) return session;
  throw new Error(
    `Catalog v2 loud fail: unknown systemId "${systemId}" (not curated; prime via getSystemGraphAsync first)`,
  );
}

export function getHomeSystemGraph(): SystemGraph {
  return getSystemGraph(getHomeSystem().id);
}

/**
 * Walk parentId links toward the root (central body with no parent).
 * Returns [body, parent, ..., root]. Cycles throw.
 */
export function resolveParentTree(bodyId: string): Body[] {
  const chain: Body[] = [];
  const seen = new Set<string>();
  let cur = getBody(bodyId);
  while (cur) {
    if (seen.has(cur.id)) {
      throw new Error(`parent tree cycle at ${cur.id}`);
    }
    seen.add(cur.id);
    chain.push(cur);
    if (!cur.parentId) break;
    cur = getBody(cur.parentId);
  }
  return chain;
}

export function getParent(id: string): Body | undefined {
  const b = getBody(id);
  if (!b?.parentId) return undefined;
  return getBody(b.parentId);
}

/** Direct children of a body (parentId === parentId), member / catalog order. */
export function listChildren(parentId: string): Body[] {
  const parent = getBody(parentId);
  if (parent?.systemId) {
    const members = getBodiesForSystem(parent.systemId);
    if (members.length > 0) {
      return members.filter((b) => b.parentId === parentId);
    }
  }
  const curated = bodies.filter((b) => b.parentId === parentId);
  if (curated.length > 0) return curated;
  // Session-only parent (archive multi-star) — scan primed bodies via system graph.
  try {
    if (parent?.systemId) {
      return getSystemGraph(parent.systemId).bodies.filter(
        (b) => b.parentId === parentId,
      );
    }
  } catch {
    /* unknown */
  }
  return [];
}

export function getBodiesByKind(kind: BodyKind): Body[] {
  return bodies.filter((b) => b.kind === kind);
}

/** UI fixture system — hide from default search unless query matches. */
export const FIXTURE_SYSTEM_ID = "sparse-test";

/** Common system aliases (id → tokens). Bodies already carry aliases in JSON. */
const SYSTEM_ALIASES: Record<string, readonly string[]> = {
  solar: ["sol", "solar system"],
  "trappist-1": ["trappist", "trappist 1"],
  "kepler-11": ["kepler 11", "kepler11"],
};

export function isFixtureSystemId(systemId: string): boolean {
  return systemId === FIXTURE_SYSTEM_ID;
}

function queryUnlocksFixture(q: string): boolean {
  return q.includes("sparse");
}

function textMatch(hay: string, q: string): boolean {
  return hay.toLowerCase().includes(q);
}

/** 0 = name/id prefix, 1 = alias prefix, 2 = includes, 3 = alias includes, 99 = no match. */
export function searchMatchRank(
  name: string,
  id: string,
  q: string,
  aliases?: readonly string[],
): number {
  const n = name.toLowerCase();
  const i = id.toLowerCase();
  if (n.startsWith(q) || i.startsWith(q)) return 0;
  if (aliases?.some((a) => a.toLowerCase().startsWith(q))) return 1;
  if (n.includes(q) || i.includes(q)) return 2;
  if (aliases?.some((a) => a.toLowerCase().includes(q))) return 3;
  return 99;
}

function systemMatchesQuery(s: System, q: string): boolean {
  return searchMatchRank(s.name, s.id, q, SYSTEM_ALIASES[s.id]) < 99;
}

function bodyMatchesQuery(b: Body, q: string): boolean {
  return searchMatchRank(b.name, b.id, q, b.aliases) < 99;
}

function compareSearchSystems(a: System, b: System, q: string): number {
  const ra = searchMatchRank(a.name, a.id, q, SYSTEM_ALIASES[a.id]);
  const rb = searchMatchRank(b.name, b.id, q, SYSTEM_ALIASES[b.id]);
  if (ra !== rb) return ra - rb;
  if (a.home === true && b.home !== true) return -1;
  if (b.home === true && a.home !== true) return 1;
  return a.name.localeCompare(b.name);
}

function compareSearchBodies(a: Body, b: Body, q: string): number {
  const kindRank: Record<BodyKind, number> = {
    black_hole: 0,
    star: 1,
    planet: 2,
    dwarf_planet: 3,
    moon: 4,
    asteroid: 5,
  };
  const ra = searchMatchRank(a.name, a.id, q, a.aliases);
  const rb = searchMatchRank(b.name, b.id, q, b.aliases);
  if (ra !== rb) return ra - rb;
  const kr = kindRank[a.kind] - kindRank[b.kind];
  if (kr !== 0) return kr;
  return a.name.localeCompare(b.name);
}

export type CatalogSearchResult = {
  systems: System[];
  bodies: Body[];
};

/**
 * Unified client-side search over systems + bodies.
 * Hides sparse-test (and its members) unless the query clearly matches ("sparse").
 */
export function searchCatalog(query: string): CatalogSearchResult {
  const q = query.trim().toLowerCase();
  if (!q) return { systems: [], bodies: [] };
  const showFixture = queryUnlocksFixture(q);

  const matchedSystems = systems.filter((s) => {
    if (!showFixture && isFixtureSystemId(s.id)) return false;
    return systemMatchesQuery(s, q);
  });

  const matchedBodies = bodies.filter((b) => {
    if (!showFixture && isFixtureSystemId(b.systemId)) return false;
    return bodyMatchesQuery(b, q);
  });

  matchedBodies.sort((a, b) => compareSearchBodies(a, b, q));
  matchedSystems.sort((a, b) => compareSearchSystems(a, b, q));

  return { systems: matchedSystems, bodies: matchedBodies };
}

/** Merge curated search with archive index stubs (names/ids). Prefix-ranked. */
export function mergeArchiveSystemHits(
  curated: CatalogSearchResult,
  archive: ReadonlyArray<{ id: string; name: string }>,
  query: string,
): CatalogSearchResult {
  const q = query.trim().toLowerCase();
  if (!q) return curated;
  const curatedIds = new Set(listSystems().map((s) => s.id));
  for (const s of curated.systems) curatedIds.add(s.id);

  const extras: System[] = [];
  for (const s of archive) {
    if (curatedIds.has(s.id)) continue;
    if (isFixtureSystemId(s.id)) continue;
    if (searchMatchRank(s.name, s.id, q) >= 99) continue;
    extras.push({
      id: s.id,
      name: s.name,
      memberIds: [],
      home: false,
    });
  }
  const systems = [...curated.systems, ...extras];
  systems.sort((a, b) => compareSearchSystems(a, b, q));
  return { systems, bodies: curated.bodies };
}

/** @deprecated Prefer searchCatalog — kept for body-only callers. */
export function searchBodies(query: string): Body[] {
  return searchCatalog(query).bodies;
}

export { hasUsableOrbit };

/** Explore deep-link for a body (includes ?system= for non-home). */
export function exploreHref(bodyId: string, systemId?: string): string {
  const body = bodyById.get(bodyId) ?? peekSessionBody(bodyId);
  const sid = systemId ?? body?.systemId;
  const homeId = getHomeSystem().id;
  const params = new URLSearchParams();
  // Archive systems are not in curated systemById — still deep-link ?system=
  if (sid && sid !== homeId) {
    params.set("system", sid);
  }
  if (bodyId) params.set("focus", bodyId);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

/** Explore deep-link for a system (no focus). Home → `/`. */
export function exploreSystemHref(systemId: string): string {
  const homeId = getHomeSystem().id;
  if (systemId === homeId) return "/";
  return `/?system=${encodeURIComponent(systemId)}`;
}

/** Body detail deep-link; includes ?system= so archive ids resolve. */
export function bodyHref(bodyId: string, systemId?: string): string {
  const body = bodyById.get(bodyId) ?? peekSessionBody(bodyId);
  const sid = systemId ?? body?.systemId;
  if (sid) return `/body/${encodeURIComponent(bodyId)}?system=${encodeURIComponent(sid)}`;
  return `/body/${encodeURIComponent(bodyId)}`;
}

export const KIND_LABEL: Record<BodyKind, string> = {
  star: "Star",
  planet: "Planet",
  dwarf_planet: "Dwarf planet",
  asteroid: "Asteroid",
  moon: "Moon",
  black_hole: "Black hole",
};

/** Kind order for Search / typeahead grouping. */
export const KIND_ORDER: BodyKind[] = [
  "black_hole",
  "star",
  "planet",
  "dwarf_planet",
  "moon",
  "asteroid",
];
