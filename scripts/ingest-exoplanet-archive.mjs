#!/usr/bin/env node
/**
 * Orbitpedia NEA archive ingest — bounded sample → public/archive plane.
 *
 * Writes (smoke, --limit ≤ 100):
 *   public/archive/systems.index.json
 *   public/archive/graphs/<systemId>.json  ({ system, bodies })
 *
 * Writes (--all or --limit > 100, or ARCHIVE_OUT=...):
 *   public/archive/bulk/...  (gitignored) or $ARCHIVE_OUT
 *
 * Does NOT touch curated src/data/systems|bodies or catalog.generated.ts.
 * Never fat-commit --all into public/archive/graphs/.
 * Public HTTP only (NEA TAP); meta.sources cite overview pages only.
 *
 * Usage (repo root):
 *   node scripts/ingest-exoplanet-archive.mjs [--limit 100] [--min-planets 2]
 *   node scripts/ingest-exoplanet-archive.mjs --all --min-planets 2
 *   node scripts/ingest-exoplanet-archive.mjs --include-single-planet --limit 50
 *   node scripts/ingest-exoplanet-archive.mjs --hosts "KOI-351,AU Mic"
 *   node scripts/ingest-exoplanet-archive.mjs --dry-run
 *   node scripts/ingest-exoplanet-archive.mjs --force-ids kepler-90
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
/** Committed smoke plane (git). */
const SMOKE_ARCHIVE_DIR = join(ROOT, "public", "archive");
/** Gitignored bulk / --all plane (or override with ARCHIVE_OUT). */
const BULK_ARCHIVE_DIR = join(ROOT, "public", "archive", "bulk");
/** Limits at or below this write the committed smoke plane (unless --all / ARCHIVE_OUT). */
const SMOKE_LIMIT_MAX = 100;

function resolveArchiveDirs(opts) {
  if (process.env.ARCHIVE_OUT) {
    const dir = process.env.ARCHIVE_OUT;
    return {
      archiveDir: dir,
      graphsDir: join(dir, "graphs"),
      indexPath: join(dir, "systems.index.json"),
      plane: "ARCHIVE_OUT",
    };
  }
  const bulk = opts.all || opts.limit > SMOKE_LIMIT_MAX;
  const dir = bulk ? BULK_ARCHIVE_DIR : SMOKE_ARCHIVE_DIR;
  return {
    archiveDir: dir,
    graphsDir: join(dir, "graphs"),
    indexPath: join(dir, "systems.index.json"),
    plane: bulk ? "bulk" : "smoke",
  };
}

const TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync";
const OVERVIEW = "https://exoplanetarchive.ipac.caltech.edu/overview";

/** ADQL TOP applies to planet rows, not hosts. --all uses this window until pagination ships. */
const TAP_ROW_CAP_ALL = 20000;

/** Curated / showcase — never overwrite without --force-ids. */
const PROTECTED_SYSTEM_IDS = new Set([
  "solar",
  "trappist-1",
  "kepler-11",
  "sparse-test",
]);

const M_SUN_KG = 1.98847e30;
const R_SUN_KM = 695_700;
const M_EARTH_KG = 5.9722e24;
const R_EARTH_KM = 6_371.0;

const COLUMNS = [
  "hostname",
  "pl_name",
  "pl_letter",
  "pl_orbsmax",
  "pl_orbper",
  "pl_rade",
  "pl_bmasse",
  "pl_orbeccen",
  "pl_orbincl",
  "pl_orblper",
  "pl_tranmid",
  "st_teff",
  "st_rad",
  "st_mass",
  "st_spectype",
  "sy_dist",
  "sy_pnum",
  "disc_year",
];

function parseArgs(argv) {
  const out = {
    limit: 100,
    minPlanets: 2, // dump v1 default: multi-planet hosts (sy_pnum >= 2)
    all: false,
    includeSinglePlanet: false,
    hosts: null,
    dryRun: false,
    verify: false,
    forceIds: new Set(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") out.limit = Math.max(1, Number(argv[++i]) || 100);
    else if (a === "--all") out.all = true;
    else if (a === "--include-single-planet") out.includeSinglePlanet = true;
    else if (a === "--min-planets")
      out.minPlanets = Math.max(1, Number(argv[++i]) || 2);
    else if (a === "--hosts") {
      out.hosts = String(argv[++i] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--verify") out.verify = true;
    else if (a === "--force-ids") {
      String(argv[++i] || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .forEach((id) => out.forceIds.add(id));
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/ingest-exoplanet-archive.mjs [options]
  --limit N               Max systems to write (default 100; ignored with --all)
  --all                   No system cap — writes gitignored public/archive/bulk/ (or ARCHIVE_OUT)
  --min-planets N         sy_pnum threshold when scanning (default 2 = multi-planet)
  --include-single-planet Set min-planets to 1 (single-planet hosts; off by default)
  --hosts a,b             Named host list (skips limit scan)
  --force-ids a,b         Allow overwrite of protected curated ids
  --dry-run               Fetch + build; do not write
  --verify               Print census vs TAP row-window host counts; no write`);
      process.exit(0);
    }
  }
  if (out.includeSinglePlanet) out.minPlanets = 1;
  if (out.all) out.limit = Number.POSITIVE_INFINITY;
  return out;
}

function kebabId(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Binary companion hostnames like "55 Cnc B" kebab-collide with planet
 * "55 Cnc b" → 55-cnc-b. Disambiguate companions as <primary>-comp-<letter>.
 */
function systemIdForHostname(hostname) {
  const m = String(hostname).trim().match(/^(.+?)\s+([A-Za-z])$/);
  if (m) {
    return `${kebabId(m[1])}-comp-${m[2].toLowerCase()}`;
  }
  return kebabId(hostname);
}

function overviewUrl(hostname) {
  // Overview pages accept the display hostname (spaces OK when encoded).
  return `${OVERVIEW}/${encodeURIComponent(hostname).replace(/%20/g, "%20")}`;
}

function num(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function omitEmpty(obj) {
  if (Array.isArray(obj)) return obj;
  if (obj === null || typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      const nested = omitEmpty(v);
      if (Object.keys(nested).length === 0) continue;
      out[k] = nested;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Minimal CSV parser (NEA quotes fields; no embedded newlines expected). */
function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length === 1 && cells[0] === "") continue;
    const row = {};
    for (let c = 0; c < headers.length; c++) {
      let v = cells[c] ?? "";
      if (v === "") v = null;
      row[headers[c]] = v;
    }
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function tapCsv(adql) {
  const url = new URL(TAP);
  url.searchParams.set("query", adql);
  url.searchParams.set("format", "csv");
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`NEA TAP HTTP ${res.status}: ${body.slice(0, 240)}`);
  }
  const text = await res.text();
  if (text.includes("QUERY_STATUS") && text.includes("ERROR")) {
    throw new Error(`NEA TAP error: ${text.slice(0, 400)}`);
  }
  return parseCsv(text);
}

function sqlStringList(names) {
  return names.map((n) => `'${String(n).replace(/'/g, "''")}'`).join(",");
}

async function fetchRows(opts) {
  const cols = COLUMNS.join(", ");
  if (opts.hosts?.length) {
    const adql = `select ${cols} from pscomppars where hostname in (${sqlStringList(opts.hosts)}) and pl_orbsmax is not null order by hostname, pl_orbsmax`;
    return tapCsv(adql);
  }
  // Pull a generous row window, then pick first N distinct hosts client-side.
  // (ADQL TOP applies to rows, not groups.)
  const rowCap = opts.all ? TAP_ROW_CAP_ALL : Math.max(opts.limit * 12, 200);
  opts._rowCap = rowCap; // for --verify reporting
  const adql = `select top ${rowCap} ${cols} from pscomppars where sy_pnum >= ${opts.minPlanets} and pl_orbsmax is not null order by sy_pnum desc, hostname, pl_orbsmax`;
  return tapCsv(adql);
}

function starColorFromTeff(teff) {
  if (teff == null) return "#FDB813";
  if (teff >= 7500) return "#A2C8FF";
  if (teff >= 6000) return "#F8F7FF";
  if (teff >= 5200) return "#FDB813";
  if (teff >= 3700) return "#FF8C42";
  return "#E84A3C";
}

function planetColor(index) {
  const palette = [
    "#C45C26",
    "#D4A574",
    "#6B93D6",
    "#C1440E",
    "#C88B3A",
    "#7EC8E3",
    "#9B7EBD",
    "#5B5DDF",
  ];
  return palette[index % palette.length];
}

function buildSystem(hostname, planetRows, fetchedAt) {
  const systemId = systemIdForHostname(hostname);
  const starId = systemId;
  const ov = overviewUrl(hostname);
  const first = planetRows[0];
  const syPnum = num(first.sy_pnum);
  const distPc = num(first.sy_dist);
  const distanceLy =
    distPc != null ? Math.round(distPc * 3.26156 * 10) / 10 : undefined;
  const hostSpectralType = first.st_spectype || undefined;
  const discYear = first.disc_year ? String(Math.trunc(num(first.disc_year) ?? first.disc_year)) : undefined;

  const planets = [];
  const memberIds = [starId];
  let pi = 0;
  for (const row of planetRows) {
    const aAu = num(row.pl_orbsmax);
    if (aAu == null || aAu <= 0) continue;
    const letter = (row.pl_letter || "").trim().toLowerCase() || kebabId(row.pl_name).split("-").pop();
    const bodyId = `${systemId}-${letter}`;
    const eRaw = num(row.pl_orbeccen);
    const iRaw = num(row.pl_orbincl);
    const wRaw = num(row.pl_orblper);
    const periodD = num(row.pl_orbper);
    const epochJd = num(row.pl_tranmid);
    const rEarth = num(row.pl_rade);
    const mEarth = num(row.pl_bmasse);

    const assumed = [];
    const e = eRaw != null ? eRaw : (assumed.push("e"), 0);
    const iDeg = iRaw != null ? iRaw : (assumed.push("iDeg"), 90);
    const wDeg = wRaw != null ? wRaw : (assumed.push("wDeg"), 0);
    assumed.push("omDeg", "maDeg");

    const facts = omitEmpty({
      massKg: mEarth != null && mEarth > 0 ? mEarth * M_EARTH_KG : undefined,
      radiusMeanKm: rEarth != null && rEarth > 0 ? rEarth * R_EARTH_KM : undefined,
      discoveryDate: discYear,
      discoveryNotes: row.pl_name ? `NEA composite: ${row.pl_name}` : undefined,
    });

    const fields = [
      "orbit.aAu",
      "orbit.periodD",
      "orbit.e",
      "orbit.iDeg",
      "orbit.wDeg",
      "orbit.epochJd",
      "facts.massKg",
      "facts.radiusMeanKm",
      "facts.discoveryDate",
    ].filter((f) => {
      if (f.startsWith("orbit.")) {
        const key = f.slice(6);
        if (key === "aAu") return true;
        if (key === "periodD") return periodD != null;
        if (key === "e") return eRaw != null;
        if (key === "iDeg") return iRaw != null;
        if (key === "wDeg") return wRaw != null;
        if (key === "epochJd") return epochJd != null;
      }
      if (f === "facts.massKg") return facts.massKg != null;
      if (f === "facts.radiusMeanKm") return facts.radiusMeanKm != null;
      if (f === "facts.discoveryDate") return discYear != null;
      return false;
    });

    planets.push(
      omitEmpty({
        id: bodyId,
        name: row.pl_name || `${hostname} ${letter}`,
        kind: "planet",
        systemId,
        facts,
        color: planetColor(pi),
        meta: {
          source: `NASA Exoplanet Archive pscomppars; orbit.frame=heliocentric relative to host ${hostname} (not SSB). omDeg=0 and maDeg=0 assumed${assumed.length ? ` (also defaulted: ${assumed.filter((x) => x !== "omDeg" && x !== "maDeg").join(", ") || "none"})` : ""}.`,
          sources: [
            {
              name: `NASA Exoplanet Archive — ${hostname} overview`,
              url: ov,
              fields,
            },
          ],
          fetchedAt,
          confidence: "assumed",
          unitsVersion: 1,
        },
        orbit: omitEmpty({
          frame: "heliocentric",
          epochJd,
          aAu,
          e: Math.min(Math.max(e, 0), 0.999999),
          iDeg,
          omDeg: 0,
          wDeg,
          maDeg: 0,
          periodD: periodD != null && periodD > 0 ? periodD : undefined,
        }),
      }),
    );
    memberIds.push(bodyId);
    pi++;
  }

  if (planets.length === 0) return null;

  const stMass = num(first.st_mass);
  const stRad = num(first.st_rad);
  const stTeff = num(first.st_teff);
  const starFacts = omitEmpty({
    massKg: stMass != null && stMass > 0 ? stMass * M_SUN_KG : undefined,
    radiusMeanKm: stRad != null && stRad > 0 ? stRad * R_SUN_KM : undefined,
    discoveryNotes: `Archive host (${planets.length} planets in this ingest slice); open from Systems / Explore when wired to archive lazy-load.`,
    discoveryDate: discYear,
  });

  const star = omitEmpty({
    id: starId,
    name: hostname,
    kind: "star",
    systemId,
    facts: starFacts,
    color: starColorFromTeff(stTeff),
    meta: {
      source: "NASA Exoplanet Archive Planetary Systems Composite Parameters (pscomppars) — stellar mass/radius; orbit frame N/A (central star)",
      sources: [
        {
          name: `NASA Exoplanet Archive — ${hostname} overview`,
          url: ov,
          fields: [
            ...(starFacts.massKg != null ? ["facts.massKg"] : []),
            ...(starFacts.radiusMeanKm != null ? ["facts.radiusMeanKm"] : []),
            "facts.discoveryNotes",
            ...(discYear ? ["facts.discoveryDate"] : []),
          ],
        },
      ],
      fetchedAt,
      confidence: "known",
      unitsVersion: 1,
    },
  });

  const system = omitEmpty({
    id: systemId,
    name: hostname,
    home: false,
    memberIds,
    blurb: `${hostname} — NASA Exoplanet Archive planetary system (${planets.length} planets in sample ingest). Sparse archive card; curated showcase systems stay hand-enriched.`,
    planetCount: syPnum ?? planets.length,
    distanceLy,
    hostSpectralType,
    meta: {
      confidence: "known",
      fetchedAt,
      sources: [
        {
          name: `NASA Exoplanet Archive — ${hostname} overview`,
          url: ov,
          fields: [
            "blurb",
            "planetCount",
            ...(distanceLy != null ? ["distanceLy"] : []),
            ...(hostSpectralType ? ["hostSpectralType"] : []),
          ],
        },
      ],
    },
  });

  return {
    systemId,
    hostname,
    graph: { system, bodies: [star, ...planets] },
    indexRow: omitEmpty({
      id: systemId,
      name: hostname,
      planetCount: syPnum ?? planets.length,
      distanceLy,
      hostSpectralType,
      overviewUrl: ov,
    }),
  };
}

function groupByHost(rows) {
  const map = new Map();
  for (const row of rows) {
    const h = row.hostname;
    if (!h) continue;
    if (!map.has(h)) map.set(h, []);
    map.get(h).push(row);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (num(a.pl_orbsmax) ?? 0) - (num(b.pl_orbsmax) ?? 0));
  }
  return map;
}


async function verifyCensus(opts) {
  const minP = opts.minPlanets;
  console.log(`--verify (sy_pnum >= ${minP}; pl_orbsmax required for ingestable planets)`);

  // Distinct host census (no TOP) — may be slower but is the true multi-planet count.
  const censusAdql = `select count(distinct hostname) as n from pscomppars where sy_pnum >= ${minP}`;
  const censusRows = await tapCsv(censusAdql);
  const censusHosts = Number(censusRows[0]?.n ?? censusRows[0]?.N ?? NaN);

  const withAAdql = `select count(distinct hostname) as n from pscomppars where sy_pnum >= ${minP} and pl_orbsmax is not null`;
  const withARows = await tapCsv(withAAdql);
  const censusWithA = Number(withARows[0]?.n ?? withARows[0]?.N ?? NaN);

  const rows = await fetchRows({ ...opts, all: opts.all || opts.limit === Number.POSITIVE_INFINITY });
  const byHost = groupByHost(rows);
  const windowHosts = byHost.size;
  const rowCap = opts._rowCap ?? (opts.all ? TAP_ROW_CAP_ALL : Math.max(opts.limit * 12, 200));

  let buildable = 0;
  let protectedHits = 0;
  for (const [hostname, planetRows] of byHost) {
    const systemId = systemIdForHostname(hostname);
    if (PROTECTED_SYSTEM_IDS.has(systemId)) {
      protectedHits++;
      continue;
    }
    if (buildSystem(hostname, planetRows, new Date().toISOString())) buildable++;
  }

  console.log(JSON.stringify({
    minPlanets: minP,
    tapRowCap: rowCap,
    planetRowsFetched: rows.length,
    distinctHostsInWindow: windowHosts,
    buildableHostsInWindow: buildable,
    protectedHostsInWindow: protectedHits,
    neaDistinctHosts_sy_pnum: censusHosts,
    neaDistinctHosts_sy_pnum_with_a: censusWithA,
    gapVsCensusWithA: Number.isFinite(censusWithA) ? censusWithA - windowHosts : null,
    note: opts.all
      ? `TOP ${TAP_ROW_CAP_ALL} planet rows may miss hosts beyond the window; pagination not implemented yet.`
      : `Bounded --limit uses TOP ${rowCap} planet rows then first N hosts.`,
  }, null, 2));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dirs = resolveArchiveDirs(opts);
  const GRAPHS_DIR = dirs.graphsDir;
  const INDEX_PATH = dirs.indexPath;
  const fetchedAt = new Date().toISOString();
  console.log(`Archive plane: ${dirs.plane} → ${dirs.archiveDir}`);

  console.log(
    opts.hosts
      ? `NEA archive ingest — hosts: ${opts.hosts.join(", ")}`
      : opts.all
        ? `NEA archive ingest — ALL systems (sy_pnum >= ${opts.minPlanets}) → bulk/ARCHIVE_OUT plane`
        : `NEA archive ingest — limit ${opts.limit} systems (sy_pnum >= ${opts.minPlanets})`,
  );

  if (opts.verify) {
    await verifyCensus(opts);
    return;
  }

  let rows;
  try {
    rows = await fetchRows(opts);
  } catch (err) {
    console.error("NEA fetch failed:", err.message || err);
    console.error(
      "Offline? Still ship script+docs. Re-run: npm run ingest:nea-sample",
    );
    process.exit(1);
  }

  const byHost = groupByHost(rows);
  const built = [];
  const skippedProtected = [];
  const skippedEmpty = [];

  for (const [hostname, planetRows] of byHost) {
    if (!opts.hosts && built.length >= opts.limit) break;
    const systemId = systemIdForHostname(hostname);
    const forced = opts.forceIds.has(systemId);
    if (PROTECTED_SYSTEM_IDS.has(systemId) && !forced) {
      skippedProtected.push(systemId);
      continue;
    }
    const item = buildSystem(hostname, planetRows, fetchedAt);
    if (!item) {
      skippedEmpty.push(systemId);
      continue;
    }
    built.push(item);
  }

  if (opts.hosts) {
    // Preserve requested order when possible
    const order = new Map(opts.hosts.map((h, i) => [systemIdForHostname(h), i]));
    built.sort(
      (a, b) => (order.get(a.systemId) ?? 999) - (order.get(b.systemId) ?? 999),
    );
  }

  const index = {
    version: 1,
    fetchedAt,
    source: "NASA Exoplanet Archive pscomppars",
    systems: built.map((b) => b.indexRow),
  };

  console.log(
    `Built ${built.length} systems; skipped protected=${skippedProtected.length} empty=${skippedEmpty.length}`,
  );

  if (opts.dryRun) {
    console.log("Dry-run — no files written. Sample ids:", built.slice(0, 8).map((b) => b.systemId).join(", "));
    return;
  }

  mkdirSync(GRAPHS_DIR, { recursive: true });

  // Merge with existing index for hosts not in this run (sample re-runs stay additive).
  let prior = [];
  if (existsSync(INDEX_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
      if (Array.isArray(prev.systems)) prior = prev.systems;
    } catch {
      /* ignore corrupt prior */
    }
  }
  const byId = new Map(prior.map((s) => [s.id, s]));
  for (const row of index.systems) byId.set(row.id, row);
  // Drop protected from index unless forced this run
  for (const id of PROTECTED_SYSTEM_IDS) {
    if (!opts.forceIds.has(id)) byId.delete(id);
  }
  const mergedIndex = {
    version: 1,
    fetchedAt,
    source: "NASA Exoplanet Archive pscomppars",
    systems: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };

  writeFileSync(INDEX_PATH, JSON.stringify(mergedIndex, null, 2) + "\n");
  for (const item of built) {
    const path = join(GRAPHS_DIR, `${item.systemId}.json`);
    writeFileSync(path, JSON.stringify(item.graph, null, 2) + "\n");
  }

  console.log(`Wrote ${INDEX_PATH} (${mergedIndex.systems.length} index rows)`);
  console.log(`Wrote ${built.length} graphs under ${GRAPHS_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
