/**
 * Archive plane access — NEA-scale systems live under public/archive/.
 * Curated Sol / showcase stay in catalog.ts + catalog.generated.ts.
 *
 * Graphs are lazy-fetched so thousands of cards never enter the client bundle.
 *
 * Base resolution (once per session):
 *   NEXT_PUBLIC_ARCHIVE_BASE → else `/archive` immediately for graphs.
 * Sync first paint uses bundled systems.index.smoke.json only (SSR == client).
 * After hydrate, HTTP `/archive/systems.index.json` (full sky index) and optional
 * `/archive/bulk` are probed in the background and adopted when larger AND
 * raDeg/decDeg coverage ≥50%. Adopts notify subscribeArchiveIndex listeners.
 * A 0%-coord dump must never replace smoke or freeze the map.
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
  mergeArchiveSystemHits,
  searchCatalog,
  type CatalogSearchResult,
  type SystemGraph,
} from "./catalog";
import {
  clearSystemGraphSession,
  rememberSystemGraph,
} from "./systemGraphSession";
/** Small sync first-paint plane — bundled. Full sky index is fetched from /archive/systems.index.json. */
import bundledSmokeIndexJson from "../../public/archive/systems.index.smoke.json";

export type ArchiveSystemSummary = {
  id: string;
  name: string;
  planetCount?: number;
  distanceLy?: number;
  /** ICRS RA degrees when known (omit if missing). */
  raDeg?: number;
  /** ICRS Dec degrees when known (omit if missing). */
  decDeg?: number;
  hostSpectralType?: string;
  /** Factual mid-dot overview for map overlay (optional). */
  blurb?: string;
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
/** HTTP archive root: committed full sky-complete index (+ smoke graphs). */
const SMOKE_ARCHIVE_BASE = "/archive";
const BULK_ARCHIVE_BASE = "/archive/bulk";

/** Quick probe budget (smoke / hung connection). */
const FETCH_TIMEOUT_MS = 1500;
/** Full ~2MB index + bulk: allow slow body/parse; abort only on long hang. */
const FULL_INDEX_TIMEOUT_MS = 20_000;

/**
 * Minimum fraction of rows with both raDeg+decDeg before adopting bulk.
 * Overnight --all dumps with 0% coords must be ignored (map gutter + O(n²) freeze).
 */
const MIN_BULK_COORD_COVERAGE = 0.5;

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
let bulkUpgradeStarted = false;
const graphCache = new Map<string, SystemGraph>();
const indexListeners = new Set<() => void>();

/**
 * Notify when indexCache is adopted/replaced (full HTTP index or bulk upgrade).
 * Map page subscribes and setStates — cache mutate alone is invisible to React.
 */
export function subscribeArchiveIndex(listener: () => void): () => void {
  indexListeners.add(listener);
  return () => {
    indexListeners.delete(listener);
  };
}

function notifyArchiveIndexListeners(): void {
  for (const listener of indexListeners) {
    try {
      listener();
    } catch {
      /* listener errors must not break adopt */
    }
  }
}

/** Adopt a larger, sky-covered index and notify subscribers. */
function adoptArchiveIndex(next: ArchiveIndex, base: string): boolean {
  if (!isAdoptableBulk(next, indexCache)) return false;
  archiveBase = base;
  indexCache = next;
  notifyArchiveIndexListeners();
  return true;
}

function indexUrl(base: string): string {
  return `${base}/systems.index.json`;
}

function graphUrl(systemId: string): string {
  const base = archiveBase ?? SMOKE_ARCHIVE_BASE;
  return `${base}/graphs/${encodeURIComponent(systemId)}.json`;
}

/** Fraction of index rows with finite raDeg and decDeg (0..1). */
export function archiveCoordCoverage(index: ArchiveIndex): number {
  const n = index.systems.length;
  if (n === 0) return 0;
  let both = 0;
  for (const s of index.systems) {
    if (
      typeof s.raDeg === "number" &&
      Number.isFinite(s.raDeg) &&
      typeof s.decDeg === "number" &&
      Number.isFinite(s.decDeg)
    ) {
      both++;
    }
  }
  return both / n;
}

/** Alias — Ephemeris / ingest docs historically used this name. */
export const archiveSkyCoordCoverage = archiveCoordCoverage;


/**
 * Fetch archive index with AbortController timeout. Abort / error → null.
 * Exported for tests and callers that need a timed probe.
 */
export async function fetchArchiveIndex(
  base: string,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<ArchiveIndex | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(indexUrl(base), { signal: ctrl.signal });
    // Connection ok — clear abort so a slow 2MB JSON parse is not killed.
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as ArchiveIndex;
    if (!data || !Array.isArray(data.systems)) return null;
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** True when bulk is larger than current cache and has usable sky coverage. */
function isAdoptableBulk(
  bulk: ArchiveIndex,
  current: ArchiveIndex | null,
): boolean {
  if (archiveCoordCoverage(bulk) < MIN_BULK_COORD_COVERAGE) return false;
  const curN = current?.systems.length ?? 0;
  return bulk.systems.length > curN;
}

/**
 * Non-blocking post-hydrate upgrade. Never awaited on first paint.
 * 1) HTTP `/archive/systems.index.json` (committed full sky index, ~2MB)
 * 2) Optional local `/archive/bulk` if even larger
 * Adopts only when coverage ≥50% and row count exceeds current cache.
 * Notifies subscribeArchiveIndex listeners on adopt.
 */
function startBackgroundBulkUpgrade(): void {
  if (bulkUpgradeStarted) return;
  if (envArchiveBase()) return;
  if (typeof window === "undefined") return;
  bulkUpgradeStarted = true;
  void (async () => {
    const full = await fetchArchiveIndex(
      SMOKE_ARCHIVE_BASE,
      FULL_INDEX_TIMEOUT_MS,
    );
    if (full) adoptArchiveIndex(full, SMOKE_ARCHIVE_BASE);

    const bulk = await fetchArchiveIndex(
      BULK_ARCHIVE_BASE,
      FULL_INDEX_TIMEOUT_MS,
    );
    if (bulk) adoptArchiveIndex(bulk, BULK_ARCHIVE_BASE);
  })();
}

/**
 * Resolve archive base once per session:
 * 1) NEXT_PUBLIC_ARCHIVE_BASE if set
 * 2) else smoke `/archive` immediately (never await bulk)
 * Bulk may upgrade later via startBackgroundBulkUpgrade.
 */
async function resolveArchiveBase(): Promise<string> {
  if (archiveBase) return archiveBase;
  const fromEnv = envArchiveBase();
  if (fromEnv) {
    archiveBase = fromEnv;
    return archiveBase;
  }
  archiveBase = SMOKE_ARCHIVE_BASE;
  startBackgroundBulkUpgrade();
  return archiveBase;
}

/** Active archive base after first resolve (null until loadArchiveIndex / sync). */
export function getArchiveBase(): string | null {
  return archiveBase;
}

/** Clear in-memory archive caches (tests / re-ingest). */
export function clearArchiveCaches(): void {
  indexCache = null;
  graphCache.clear();
  archiveBase = null;
  bulkUpgradeStarted = false;
  indexListeners.clear();
  clearSystemGraphSession();
}

/** Validate + clone the committed smoke index for in-memory use. */
function bundledSmokeArchiveIndex(): ArchiveIndex {
  const raw = bundledSmokeIndexJson as ArchiveIndex;
  if (!raw || !Array.isArray(raw.systems)) {
    return { version: 1, systems: [] };
  }
  return {
    version: raw.version ?? 1,
    fetchedAt: raw.fetchedAt,
    source: raw.source,
    systems: [...raw.systems],
  };
}

/**
 * Sync curated + bundled smoke extras — no await, no fetch, ignores indexCache.
 * First paint for the Systems map must match SSR and client (~100+ archive).
 * Post-hydrate upgrades use listSystemsMergedSync / listSystemsAsync + subscribe.
 */
export function listSystemsWithSmokeSync(): Array<
  System | ArchiveSystemSummary
> {
  const curated = listSystems();
  const curatedIds = new Set(curated.map((s) => s.id));
  const extra = bundledSmokeArchiveIndex().systems.filter(
    (s) => !curatedIds.has(s.id),
  );
  return [...curated, ...extra];
}

/**
 * Curated + current indexCache (or bundled smoke if cache empty).
 * Used after archive adopts notify the map to setState without remount.
 */
export function listSystemsMergedSync(): Array<
  System | ArchiveSystemSummary
> {
  const curated = listSystems();
  const curatedIds = new Set(curated.map((s) => s.id));
  const archive =
    indexCache?.systems ?? bundledSmokeArchiveIndex().systems;
  const extra = archive.filter((s) => !curatedIds.has(s.id));
  return [...curated, ...extra];
}

export async function loadArchiveIndex(): Promise<ArchiveIndex> {
  if (indexCache) {
    startBackgroundBulkUpgrade();
    return indexCache;
  }
  const base = await resolveArchiveBase();
  // resolveArchiveBase never fills indexCache from bulk anymore
  if (indexCache) return indexCache;

  // Full sky index at `/archive/systems.index.json` (~2MB) — long timeout.
  // Env override may point at a CDN/bulk prefix; same coverage gate.
  const data = await fetchArchiveIndex(base, FULL_INDEX_TIMEOUT_MS);
  if (data) {
    // Fail-closed: near-zero coords must not replace smoke (map freeze).
    if (archiveCoordCoverage(data) >= MIN_BULK_COORD_COVERAGE) {
      indexCache = data;
      notifyArchiveIndexListeners();
      startBackgroundBulkUpgrade();
      return data;
    }
    if (base !== SMOKE_ARCHIVE_BASE) {
      archiveBase = SMOKE_ARCHIVE_BASE;
    }
  }

  // HTTP failed or rejected — bundled smoke (never curated-only).
  indexCache = bundledSmokeArchiveIndex();
  startBackgroundBulkUpgrade();
  return indexCache;
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
 *
 * Does not await a hangable bulk probe; smoke HTTP (timed) or bundled smoke.
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
    // loadArchiveIndex prefers HTTP then bundled smoke; if both somehow fail,
    // still try the bundled smoke directly so the map is not curated-only.
    archive = bundledSmokeArchiveIndex().systems;
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

/**
 * Curated searchCatalog + archive index names/ids (cached). Prefix-ranked.
 * Lean typeahead / Search page — no graph fetch.
 */
export async function searchCatalogAsync(
  query: string,
): Promise<CatalogSearchResult> {
  const curated = searchCatalog(query);
  const q = query.trim();
  if (!q) return curated;
  try {
    const archive = await listArchiveSystems();
    return mergeArchiveSystemHits(curated, archive, q);
  } catch {
    return curated;
  }
}
