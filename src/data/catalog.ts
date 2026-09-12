import {
  CatalogSchema,
  hasUsableOrbit,
  type Body,
  type BodyKind,
  type Catalog,
  type System,
} from "./schema";
import { loadedBodies, loadedSystems } from "./catalog.generated";

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
  return systemById.get(id);
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
  return bodyById.get(id);
}

export function getBodiesForSystem(systemId: string): Body[] {
  const sys = systemById.get(systemId);
  if (!sys) return [];
  const out: Body[] = [];
  for (const mid of sys.memberIds) {
    const b = bodyById.get(mid);
    if (b) out.push(b);
  }
  return out;
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
  const system = getSystem(systemId);
  if (!system) {
    throw new Error(`Catalog v2 loud fail: unknown systemId "${systemId}"`);
  }
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
  let cur = bodyById.get(bodyId);
  while (cur) {
    if (seen.has(cur.id)) {
      throw new Error(`parent tree cycle at ${cur.id}`);
    }
    seen.add(cur.id);
    chain.push(cur);
    if (!cur.parentId) break;
    cur = bodyById.get(cur.parentId);
  }
  return chain;
}

export function getParent(id: string): Body | undefined {
  const b = bodyById.get(id);
  if (!b?.parentId) return undefined;
  return bodyById.get(b.parentId);
}

/** Direct children of a body (parentId === parentId), catalog order. */
export function listChildren(parentId: string): Body[] {
  return bodies.filter((b) => b.parentId === parentId);
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

function systemMatchesQuery(s: System, q: string): boolean {
  if (textMatch(s.id, q) || textMatch(s.name, q)) return true;
  const aliases = SYSTEM_ALIASES[s.id];
  return aliases?.some((a) => textMatch(a, q)) ?? false;
}

function bodyMatchesQuery(b: Body, q: string): boolean {
  if (textMatch(b.name, q) || textMatch(b.id, q)) return true;
  return b.aliases?.some((a) => textMatch(a, q)) ?? false;
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

  // Stable kind order for grouped UIs.
  const kindRank: Record<BodyKind, number> = {
    star: 0,
    planet: 1,
    dwarf_planet: 2,
    moon: 3,
    asteroid: 4,
  };
  matchedBodies.sort((a, b) => {
    const kr = kindRank[a.kind] - kindRank[b.kind];
    if (kr !== 0) return kr;
    return a.name.localeCompare(b.name);
  });
  matchedSystems.sort((a, b) => {
    if (a.home === true && b.home !== true) return -1;
    if (b.home === true && a.home !== true) return 1;
    return a.name.localeCompare(b.name);
  });

  return { systems: matchedSystems, bodies: matchedBodies };
}

/** @deprecated Prefer searchCatalog — kept for body-only callers. */
export function searchBodies(query: string): Body[] {
  return searchCatalog(query).bodies;
}

export { hasUsableOrbit };

/** Explore deep-link for a body (includes ?system= for non-home). */
export function exploreHref(bodyId: string, systemId?: string): string {
  const body = bodyById.get(bodyId);
  const sid = systemId ?? body?.systemId;
  const homeId = getHomeSystem().id;
  const params = new URLSearchParams();
  if (sid && sid !== homeId && systemById.has(sid)) {
    params.set("system", sid);
  }
  if (body) params.set("focus", bodyId);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

/** Explore deep-link for a system (no focus). Home → `/`. */
export function exploreSystemHref(systemId: string): string {
  const homeId = getHomeSystem().id;
  if (!systemById.has(systemId) || systemId === homeId) return "/";
  return `/?system=${encodeURIComponent(systemId)}`;
}

export const KIND_LABEL: Record<BodyKind, string> = {
  star: "Star",
  planet: "Planet",
  dwarf_planet: "Dwarf planet",
  asteroid: "Asteroid",
  moon: "Moon",
};

/** Kind order for Search / typeahead grouping. */
export const KIND_ORDER: BodyKind[] = [
  "star",
  "planet",
  "dwarf_planet",
  "moon",
  "asteroid",
];
