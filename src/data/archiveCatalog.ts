/**
 * Archive plane access — NEA-scale systems live under public/archive/.
 * Curated Sol / showcase stay in catalog.ts + catalog.generated.ts.
 *
 * Graphs are lazy-fetched so thousands of cards never enter the client bundle.
 */
import {
  BodySchema,
  SystemSchema,
  type Body,
  type System,
} from "./schema";
import {
  getSystemGraph,
  isCuratedSystemId,
  listSystems,
  registerLoadedSystemGraph,
  type SystemGraph,
} from "./catalog";

export type ArchiveSystemSummary = {
  id: string;
  name: string;
  planetCount?: number;
  distanceLy?: number;
  hostSpectralType?: string;
  overviewUrl?: string;
};

export type ArchiveIndex = {
  version: number;
  fetchedAt?: string;
  source?: string;
  systems: ArchiveSystemSummary[];
};

export type ArchiveSystemGraphFile = {
  system: System;
  bodies: Body[];
};

const INDEX_URL = "/archive/systems.index.json";

function graphUrl(systemId: string): string {
  return `/archive/graphs/${encodeURIComponent(systemId)}.json`;
}

let indexCache: ArchiveIndex | null = null;
const graphCache = new Map<string, SystemGraph>();

/** Clear in-memory archive caches (tests / re-ingest). */
export function clearArchiveCaches(): void {
  indexCache = null;
  graphCache.clear();
}

export async function loadArchiveIndex(): Promise<ArchiveIndex> {
  if (indexCache) return indexCache;
  const res = await fetch(INDEX_URL);
  if (!res.ok) {
    throw new Error(`archive index HTTP ${res.status} at ${INDEX_URL}`);
  }
  const data = (await res.json()) as ArchiveIndex;
  if (!data || !Array.isArray(data.systems)) {
    throw new Error("archive index missing systems[]");
  }
  indexCache = data;
  return data;
}

export async function listArchiveSystems(): Promise<ArchiveSystemSummary[]> {
  const idx = await loadArchiveIndex();
  return [...idx.systems].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Lazy-load one archive graph chunk. Does not read curated Store B cards.
 */
export async function getArchiveSystemGraph(
  systemId: string,
): Promise<SystemGraph> {
  const cached = graphCache.get(systemId);
  if (cached) {
    registerLoadedSystemGraph(cached);
    return cached;
  }
  const res = await fetch(graphUrl(systemId));
  if (!res.ok) {
    throw new Error(
      `archive graph HTTP ${res.status} for "${systemId}" (${graphUrl(systemId)})`,
    );
  }
  const data = (await res.json()) as ArchiveSystemGraphFile;
  if (!data?.system || !Array.isArray(data.bodies) || data.bodies.length === 0) {
    throw new Error(`archive graph "${systemId}" missing system/bodies`);
  }
  if (data.system.id !== systemId) {
    throw new Error(
      `archive graph id mismatch: file claims "${data.system.id}" vs "${systemId}"`,
    );
  }
  // Loud-fail junk chunks (same Zod contract as curated Store B).
  const system = SystemSchema.parse(data.system);
  const bodies = data.bodies.map((b, i) => {
    try {
      return BodySchema.parse(b);
    } catch (err) {
      throw new Error(
        `archive graph "${systemId}" body[${i}] id=${(b as Body)?.id ?? "?"} failed Zod: ${err}`,
      );
    }
  });
  for (const mid of system.memberIds) {
    if (!bodies.some((b) => b.id === mid)) {
      throw new Error(
        `archive graph "${systemId}" memberId missing body card: ${mid}`,
      );
    }
  }
  for (const b of bodies) {
    if (b.systemId !== systemId) {
      throw new Error(
        `archive graph "${systemId}" body "${b.id}" systemId "${b.systemId}" mismatch`,
      );
    }
  }
  const graph: SystemGraph = { system, bodies };
  graphCache.set(systemId, graph);
  registerLoadedSystemGraph(graph);
  return graph;
}

/** Curated sync hit first; otherwise fetch archive chunk. */
export async function getSystemGraphAsync(
  systemId: string,
): Promise<SystemGraph> {
  if (isCuratedSystemId(systemId)) {
    return getSystemGraph(systemId);
  }
  return getArchiveSystemGraph(systemId);
}

/**
 * Curated systems first (home ordered), then archive index rows whose ids
 * are not already curated. Archive entries are thin summaries — load the
 * graph via getSystemGraphAsync before Explore.
 */
export async function listSystemsAsync(): Promise<
  Array<System | ArchiveSystemSummary>
> {
  const curated = listSystems();
  const curatedIds = new Set(curated.map((s) => s.id));
  let archive: ArchiveSystemSummary[] = [];
  try {
    archive = await listArchiveSystems();
  } catch {
    // Index optional until first ingest; curated-only is fine.
    return curated;
  }
  const extra = archive.filter((s) => !curatedIds.has(s.id));
  return [...curated, ...extra];
}

export function isArchiveOnlySystemId(systemId: string): boolean {
  return !isCuratedSystemId(systemId);
}
