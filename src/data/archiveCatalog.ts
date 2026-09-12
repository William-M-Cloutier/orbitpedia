/**
 * Archive plane access — NEA-scale systems live under public/archive/.
 * Curated Sol / showcase stay in catalog.ts + catalog.generated.ts.
 *
 * Graphs are lazy-fetched so thousands of cards never enter the client bundle.
 *
 * Base resolution (once per session):
 *   NEXT_PUBLIC_ARCHIVE_BASE → else /archive/bulk if present → else /archive (smoke).
 * Bulk is gitignored; never import archive JSON into the client bundle.
 */
import {
  BodySchema,
  SystemSchema,
  type Body,
  type System,
} from "./schema";
import {
  getSystem,
  getSystemGraph,
  listSystems,
  type SystemGraph,
} from "./catalog";
import {
  clearSystemGraphSession,
  rememberSystemGraph,
} from "./systemGraphSession";

export type ArchiveSystemSummary = {
  id: string;
  name: string;
  planetCount?: number;
  distanceLy?: number;
  hostSpectralType?: string;
  overviewUrl?: string;
  /** Archive hasGas (≳50 M⊕ or ≳4 R⊕). Missing = unknown / pre-flag index. */
  hasGas?: boolean;
  /** Bound stars (sy_snum). Missing = treat as 1 for map filters. */
  starCount?: number;
  /**
   * Companion spectral types when known (never invented). May be shorter than
   * starCount - 1; map paints unknown wedges as Other.
   */
  companionSpectralTypes?: string[];
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

/** Smoke plane (committed). Bulk plane is gitignored local/dev. */
const SMOKE_ARCHIVE_BASE = "/archive";
const BULK_ARCHIVE_BASE = "/archive/bulk";

/**
 * Override with NEXT_PUBLIC_ARCHIVE_BASE (e.g. "/archive/bulk" or a CDN prefix).
 * Production default remains smoke `/archive` unless env is set.
 */
function envArchiveBase(): string | null {
  const raw = process.env.NEXT_PUBLIC_ARCHIVE_BASE?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

let archiveBase: string | null = null;
let indexCache: ArchiveIndex | null = null;
const graphCache = new Map<string, SystemGraph>();

function indexUrl(base: string): string {
  return `${base}/systems.index.json`;
}

function graphUrl(systemId: string): string {
  const base = archiveBase ?? SMOKE_ARCHIVE_BASE;
  return `${base}/graphs/${encodeURIComponent(systemId)}.json`;
}

async function fetchArchiveIndex(base: string): Promise<ArchiveIndex | null> {
  try {
    const res = await fetch(indexUrl(base));
    if (!res.ok) return null;
    const data = (await res.json()) as ArchiveIndex;
    if (!data || !Array.isArray(data.systems)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Resolve archive base once per session:
 * 1) NEXT_PUBLIC_ARCHIVE_BASE if set
 * 2) else prefer /archive/bulk when present (local --all)
 * 3) else smoke /archive
 */
async function resolveArchiveBase(): Promise<string> {
  if (archiveBase) return archiveBase;
  const fromEnv = envArchiveBase();
  if (fromEnv) {
    archiveBase = fromEnv;
    return archiveBase;
  }
  const bulk = await fetchArchiveIndex(BULK_ARCHIVE_BASE);
  if (bulk) {
    archiveBase = BULK_ARCHIVE_BASE;
    indexCache = bulk;
    return archiveBase;
  }
  archiveBase = SMOKE_ARCHIVE_BASE;
  return archiveBase;
}

/** Active archive base after first resolve (null until loadArchiveIndex). */
export function getArchiveBase(): string | null {
  return archiveBase;
}

/** Clear in-memory archive caches (tests / re-ingest). */
export function clearArchiveCaches(): void {
  indexCache = null;
  graphCache.clear();
  archiveBase = null;
  clearSystemGraphSession();
}

export async function loadArchiveIndex(): Promise<ArchiveIndex> {
  if (indexCache) return indexCache;
  const base = await resolveArchiveBase();
  // resolveArchiveBase may have already filled indexCache when probing bulk
  if (indexCache) return indexCache;
  const data = await fetchArchiveIndex(base);
  if (!data) {
    throw new Error(`archive index missing/unreadable at ${indexUrl(base)}`);
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
  if (cached) return cached;
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
  rememberSystemGraph(graph);
  return graph;
}

/** Curated sync hit first; otherwise fetch archive chunk. */
export async function getSystemGraphAsync(
  systemId: string,
): Promise<SystemGraph> {
  if (getSystem(systemId)) {
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
  return !getSystem(systemId);
}

/**
 * Infer likely archive systemId from a body id (`hd-215152-b` → `hd-215152`).
 * Archive ingest uses `${systemId}-${pl_letter}`.
 */
export function inferSystemIdFromBodyId(bodyId: string): string | undefined {
  const i = bodyId.lastIndexOf("-");
  if (i <= 0) return undefined;
  const suffix = bodyId.slice(i + 1);
  // pl_letter is typically a short letter (b, c, …) or rare multi-char
  if (!/^[a-z0-9]{1,4}$/i.test(suffix)) return undefined;
  return bodyId.slice(0, i);
}

/**
 * Resolve an archive (or curated-via-async) body by id. Primes session graph.
 * Prefer systemIdHint from `?system=` / Details link when available.
 */
export async function getBodyAsync(
  bodyId: string,
  systemIdHint?: string,
): Promise<Body | undefined> {
  const tried = new Set<string>();
  const trySystem = async (sid: string): Promise<Body | undefined> => {
    if (!sid || tried.has(sid)) return undefined;
    tried.add(sid);
    try {
      const g = await getSystemGraphAsync(sid);
      return g.bodies.find((b) => b.id === bodyId);
    } catch {
      return undefined;
    }
  };

  if (systemIdHint) {
    const hit = await trySystem(systemIdHint);
    if (hit) return hit;
  }
  const inferred = inferSystemIdFromBodyId(bodyId);
  if (inferred) {
    const hit = await trySystem(inferred);
    if (hit) return hit;
  }

  // Prefix scan of archive index (lean — one index fetch, few graph fetches).
  try {
    const archive = await listArchiveSystems();
    for (const s of archive) {
      if (bodyId === s.id || bodyId.startsWith(`${s.id}-`)) {
        const hit = await trySystem(s.id);
        if (hit) return hit;
      }
    }
  } catch {
    /* index optional */
  }
  return undefined;
}
