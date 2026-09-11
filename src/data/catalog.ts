import {
  CatalogSchema,
  hasUsableOrbit,
  type Body,
  type BodyKind,
  type Catalog,
  type System,
} from "./schema";

import solarSystem from "./systems/solar.json";

import sun from "./bodies/sun.json";
import mercury from "./bodies/mercury.json";
import venus from "./bodies/venus.json";
import earth from "./bodies/earth.json";
import moon from "./bodies/moon.json";
import mars from "./bodies/mars.json";
import jupiter from "./bodies/jupiter.json";
import saturn from "./bodies/saturn.json";
import uranus from "./bodies/uranus.json";
import neptune from "./bodies/neptune.json";
import pluto from "./bodies/pluto.json";
import ceres from "./bodies/ceres.json";
import vesta from "./bodies/vesta.json";
import pallas from "./bodies/pallas.json";
import hygiea from "./bodies/hygiea.json";

/**
 * Assembled Store B catalog (v2). Explore loads one system graph via
 * getHomeSystemGraph() — never assume a flat forever-all-bodies list.
 */
const raw = {
  version: 2 as const,
  systems: [solarSystem],
  bodies: [
    sun,
    mercury,
    venus,
    earth,
    moon,
    mars,
    jupiter,
    saturn,
    uranus,
    neptune,
    pluto,
    ceres,
    vesta,
    pallas,
    hygiea,
  ],
};

export const catalog: Catalog = CatalogSchema.parse(raw);

export const systems: System[] = catalog.systems;
export const bodies: Body[] = catalog.bodies;

const systemById = new Map(systems.map((s) => [s.id, s]));
const bodyById = new Map(bodies.map((b) => [b.id, b]));

export function getSystem(id: string): System | undefined {
  return systemById.get(id);
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

export function searchBodies(query: string): Body[] {
  const q = query.trim().toLowerCase();
  if (!q) return bodies;
  return bodies.filter((b) => {
    if (b.name.toLowerCase().includes(q)) return true;
    if (b.id.toLowerCase().includes(q)) return true;
    return b.aliases?.some((a) => a.toLowerCase().includes(q)) ?? false;
  });
}

export { hasUsableOrbit };

export const KIND_LABEL: Record<BodyKind, string> = {
  star: "Star",
  planet: "Planet",
  dwarf_planet: "Dwarf planet",
  asteroid: "Asteroid",
  moon: "Moon",
};
