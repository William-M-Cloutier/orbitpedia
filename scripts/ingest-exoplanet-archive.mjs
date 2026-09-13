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
 *   node scripts/ingest-exoplanet-archive.mjs [--limit 100] [--min-planets 1]
 *   node scripts/ingest-exoplanet-archive.mjs --all --min-planets 1
 *   node scripts/ingest-exoplanet-archive.mjs --include-single-planet --limit 50
 *   node scripts/ingest-exoplanet-archive.mjs --hosts "KOI-351,AU Mic"
 *   node scripts/ingest-exoplanet-archive.mjs --dry-run
 *   node scripts/ingest-exoplanet-archive.mjs --force-ids kepler-90
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Box layout: file at project root; repo layout: under scripts/. */
const ROOT =
  basename(__dirname) === "scripts" ? join(__dirname, "..") : __dirname;
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
  ]);

const M_SUN_KG = 1.98847e30;
const R_SUN_KM = 695_700;
const M_EARTH_KG = 5.9722e24;
const R_EARTH_KM = 6_371.0;

/** hasGas filter (honest archive thresholds — either is enough). */
const GAS_MASS_MEARTH = 50; // ≳ Neptune/Saturn class by mass
const GAS_RADIUS_REARTH = 4; // inflated / giant by radius

function planetLooksGas(mEarth, rEarth) {
  if (mEarth != null && mEarth >= GAS_MASS_MEARTH) return true;
  if (rEarth != null && rEarth >= GAS_RADIUS_REARTH) return true;
  return false;
}

/** Factual archive discovery note — omit when year and method both missing. */
function discoveryNote(discYear, method) {
  const m = method != null && String(method).trim() ? String(method).trim() : "";
  if (discYear && m) return `Discovered ${discYear} (${m}).`;
  if (discYear) return `Discovered ${discYear}.`;
  if (m) return `Discovered via ${m}.`;
  return undefined;
}


/** Distance label matching Sky systemOverviewBlurb. */
function formatDistanceLy(ly) {
  if (!Number.isFinite(ly) || ly < 0) return "";
  if (ly < 10) return `${Number(ly.toPrecision(2))} ly`;
  if (ly < 100) return `${Number(ly.toPrecision(3))} ly`;
  if (ly < 1000) return `${Math.round(ly)} ly`;
  return `${Math.round(ly).toLocaleString("en-US")} ly`;
}

/**
 * System overview blurb — Sky locked one-liner (systemOverviewBlurb prefers this).
 * Shape: `{hostname} ({spectral?}) — {N} planet(s)[, {S} stars]; {distanceLy} ly; first confirmed {year} ({method}).`
 * Omit unknowns; stars only when ≥2; ≤~160 chars; never invent.
 */
function buildSystemOverviewBlurb({
  name,
  spectral,
  planetCount,
  starCount,
  distanceLy,
  firstYear,
  firstMethod,
}) {
  const head = spectral ? `${name} (${spectral})` : name;
  const countBits = [];
  if (planetCount > 0) {
    countBits.push(`${planetCount} planet${planetCount === 1 ? "" : "s"}`);
  }
  if (starCount >= 2) countBits.push(`${starCount} stars`);
  const clauses = [];
  if (countBits.length) clauses.push(`${head} — ${countBits.join(", ")}`);
  else clauses.push(head);

  if (distanceLy != null && Number.isFinite(distanceLy) && distanceLy > 0) {
    const d = formatDistanceLy(distanceLy);
    if (d) clauses.push(d); // already includes " ly"
  }

  if (firstYear) {
    clauses.push(
      firstMethod
        ? `first confirmed ${firstYear} (${firstMethod})`
        : `first confirmed ${firstYear}`,
    );
  }

  const out = clauses.join("; ") + (clauses.length ? "." : "");
  if (!out || out === ".") return undefined;
  return out.length > 160 ? `${out.slice(0, 157).trimEnd()}…` : out;
}

/** Compact mid-dot line for archive index / map overlay (Sky optional path). */
function buildIndexBlurb({
  spectral,
  planetCount,
  starCount,
  distanceLy,
  firstYear,
}) {
  const parts = [];
  if (spectral) parts.push(spectral);
  if (planetCount > 0) {
    parts.push(`${planetCount} planet${planetCount === 1 ? "" : "s"}`);
  }
  if (starCount >= 2) parts.push(`${starCount} stars`);
  if (firstYear) parts.push(`first world ${firstYear}`);
  if (distanceLy != null && Number.isFinite(distanceLy) && distanceLy > 0) {
    const d = formatDistanceLy(distanceLy);
    if (d) parts.push(d);
  }
  return parts.length ? parts.join(" · ") : undefined;
}


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
  "ra",
  "dec",
  "sy_pnum",
  "sy_snum",
  "cb_flag",
  "disc_year",
  "discoverymethod",
];

function parseArgs(argv) {
  const out = {
    limit: 100,
    minPlanets: 1, // Include single-planet hosts by default
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
      out.minPlanets = Math.max(1, Number(argv[++i]) || 1);
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
  --min-planets N         sy_pnum threshold when scanning (default 1 = include singles)
  --include-single-planet Set min-planets to 1 (redundant with default; kept for compat)
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

/**
 * Family key for multi-star merge: strip trailing " A"|" B"|" C"|" N"|" S"
 * (case-insensitive single letter / N / S).
 */
function familyKey(hostname) {
  const s = String(hostname).trim();
  const m = s.match(/^(.+?)\s+([A-Za-zNS])$/i);
  if (m) return m[1].trim();
  return s;
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
    // pl_orbsmax may be null — still ingest planet cards without orbit.
    const adql = `select ${cols} from pscomppars where hostname in (${sqlStringList(opts.hosts)}) order by hostname, pl_orbsmax`;
    return tapCsv(adql);
  }
  // Pull a generous row window, then pick first N distinct families client-side.
  // (ADQL TOP applies to rows, not groups.) Wide multiplier so multi-planet
  // hosts are usually complete before the family limit cuts.
  if (opts.minPlanets >= 2) {
    const rowCap = opts.all ? TAP_ROW_CAP_ALL : Math.max(opts.limit * 24, 400);
    opts._rowCap = rowCap;
    const adql = `select top ${rowCap} ${cols} from pscomppars where sy_pnum >= ${opts.minPlanets} order by sy_pnum desc, hostname, pl_orbsmax`;
    return tapCsv(adql);
  }

  // minPlanets === 1: multi-planet window + singles window so bounded smoke includes both.
  const multiCap = opts.all ? TAP_ROW_CAP_ALL : Math.max(opts.limit * 20, 400);
  const singleCap = opts.all
    ? Math.min(8000, TAP_ROW_CAP_ALL)
    : Math.max(opts.limit * 6, 150);
  opts._rowCap = multiCap + singleCap;
  const multi = await tapCsv(
    `select top ${multiCap} ${cols} from pscomppars where sy_pnum >= 2 order by sy_pnum desc, hostname, pl_orbsmax`,
  );
  const singles = await tapCsv(
    `select top ${singleCap} ${cols} from pscomppars where sy_pnum = 1 order by hostname, pl_orbsmax`,
  );
  return [...multi, ...singles];
}

function starColorFromTeff(teff) {
  if (teff == null) return "#FDB813";
  if (teff >= 7500) return "#A2C8FF";
  if (teff >= 6000) return "#F8F7FF";
  if (teff >= 5200) return "#FDB813";
  if (teff >= 3700) return "#FF8C42";
  return "#E84A3C";
}

const PLACEHOLDER_STAR_COLOR = "#9aa3ad";

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

/**
 * Pick primary hostname for a family: prefer the bare family name if present,
 * else the one without a companion suffix, else shortest / first sorted.
 */
function pickPrimaryHostname(hostnames, familyName) {
  const set = [...new Set(hostnames.filter(Boolean))];
  if (set.includes(familyName)) return familyName;
  const bare = set.find((h) => familyKey(h) === h);
  if (bare) return bare;
  // Prefer "… A" over "… B" etc.
  const withA = set.find((h) => /\s+A$/i.test(h));
  if (withA) return withA;
  return set.sort((a, b) => a.localeCompare(b))[0];
}

/** Companion letter from hostname like "55 Cnc B" → "B", else null. */
function companionLetter(hostname) {
  const m = String(hostname).trim().match(/\s+([A-Za-zNS])$/i);
  return m ? m[1].toUpperCase() : null;
}

/** Great-circle separation in arcseconds (RA/Dec degrees). */
function angularSepArcsec(ra1, dec1, ra2, dec2) {
  const d2r = Math.PI / 180;
  const a1 = ra1 * d2r;
  const d1 = dec1 * d2r;
  const a2 = ra2 * d2r;
  const d2 = dec2 * d2r;
  let cosd =
    Math.sin(d1) * Math.sin(d2) +
    Math.cos(d1) * Math.cos(d2) * Math.cos(a1 - a2);
  cosd = Math.max(-1, Math.min(1, cosd));
  return Math.acos(cosd) * (180 / Math.PI) * 3600;
}

/**
 * Projected physical separation (AU) ≈ θ″ × d_pc (small-angle).
 * Prefer primary distance; omit if coords/dist missing or unresolved (θ≈0).
 */
function projectedSepAuFromCoords(primaryRow, companionRow) {
  const ra1 = num(primaryRow?.ra);
  const dec1 = num(primaryRow?.dec);
  const ra2 = num(companionRow?.ra);
  const dec2 = num(companionRow?.dec);
  const distPc = num(primaryRow?.sy_dist) ?? num(companionRow?.sy_dist);
  if (
    ra1 == null ||
    dec1 == null ||
    ra2 == null ||
    dec2 == null ||
    distPc == null ||
    !(distPc > 0)
  ) {
    return undefined;
  }
  const ang = angularSepArcsec(ra1, dec1, ra2, dec2);
  if (!(ang > 1e-4)) return undefined;
  const sep = ang * distPc;
  if (!(sep > 0) || !Number.isFinite(sep)) return undefined;
  if (sep >= 100) return Math.round(sep * 10) / 10;
  if (sep >= 1) return Math.round(sep * 100) / 100;
  return Math.round(sep * 1000) / 1000;
}

function scoreStellarHostRow(r) {
  let s = 0;
  if (num(r?.ra) != null) s += 4;
  if (num(r?.dec) != null) s += 4;
  if (num(r?.sy_dist) != null && num(r.sy_dist) > 0) s += 4;
  if (num(r?.st_mass) != null) s += 2;
  if (num(r?.st_rad) != null) s += 1;
  if (num(r?.st_teff) != null) s += 1;
  if (r?.st_spectype && String(r.st_spectype).trim()) s += 1;
  return s;
}

/** Best stellarhosts row per hostname (sy_snum ≥ 2); lean NEA path for projectedSepAu. */
async function fetchStellarHostsByHostname() {
  const adql =
    "select hostname, ra, dec, sy_dist, st_mass, st_rad, st_teff, st_spectype, sy_snum from stellarhosts where sy_snum >= 2";
  const rows = await tapCsv(adql);
  const map = new Map();
  for (const r of rows) {
    const h = r.hostname;
    if (!h) continue;
    const prev = map.get(h);
    if (!prev || scoreStellarHostRow(r) > scoreStellarHostRow(prev)) {
      map.set(h, r);
    }
  }
  return map;
}

function indexStellarHostsByFamily(stellarHosts) {
  const byFam = new Map();
  if (!stellarHosts) return byFam;
  for (const h of stellarHosts.keys()) {
    const k = familyKey(h);
    if (!byFam.has(k)) byFam.set(k, []);
    byFam.get(k).push(h);
  }
  return byFam;
}

/** Prefer stellarhosts coords; fall back to pscomppars planet-host row. */
function mergeStarRow(hostname, planetRows, stellarHosts) {
  const sh = stellarHosts?.get(hostname) || null;
  const pr =
    (planetRows || []).find((r) => r.hostname === hostname) || null;
  if (!sh && !pr) return null;
  if (!sh) return pr;
  if (!pr) return sh;
  return {
    ...pr,
    ra: num(sh.ra) != null ? sh.ra : pr.ra,
    dec: num(sh.dec) != null ? sh.dec : pr.dec,
    sy_dist: num(sh.sy_dist) != null ? sh.sy_dist : pr.sy_dist,
    st_mass: num(sh.st_mass) != null ? sh.st_mass : pr.st_mass,
    st_rad: num(sh.st_rad) != null ? sh.st_rad : pr.st_rad,
    st_teff: num(sh.st_teff) != null ? sh.st_teff : pr.st_teff,
    st_spectype: sh.st_spectype || pr.st_spectype,
  };
}

function buildStarBody({
  id,
  name,
  systemId,
  row,
  fetchedAt,
  ov,
  discYear,
  discMethod,
  placeholder = false,
  parentId = undefined,
  projectedSepAu = undefined,
}) {
  // Orbit Viz Explore (eae49ee): primary has no orbit; companions/placeholders
  // may set parentId → primaryStarId for the rail. Never invent orbit elements.
  if (placeholder) {
    return omitEmpty({
      id,
      name,
      kind: "star",
      systemId,
      parentId,
      color: PLACEHOLDER_STAR_COLOR,
      meta: {
        source: "Placeholder companion — sy_snum slot with no archive stellar row",
        sources: [
          {
            name: `NASA Exoplanet Archive — overview`,
            url: ov,
            fields: [],
          },
        ],
        fetchedAt,
        confidence: "placeholder",
        unitsVersion: 1,
      },
    });
  }

  const stMass = num(row?.st_mass);
  const stRad = num(row?.st_rad);
  const stTeff = num(row?.st_teff);
  // Do not copy NEA planet disc_year/method onto stars — misleading on kind:star.
  const starFacts = omitEmpty({
    massKg: stMass != null && stMass > 0 ? stMass * M_SUN_KG : undefined,
    radiusMeanKm: stRad != null && stRad > 0 ? stRad * R_SUN_KM : undefined,
    discoveryDate: discYear,
    projectedSepAu:
      projectedSepAu != null &&
      Number.isFinite(projectedSepAu) &&
      projectedSepAu > 0
        ? projectedSepAu
        : undefined,
  });
  const hasReal =
    starFacts.massKg != null ||
    starFacts.radiusMeanKm != null ||
    (row?.st_spectype && String(row.st_spectype).trim());
  const sepDerived = starFacts.projectedSepAu != null;
  const approximateFields = sepDerived ? ["facts.projectedSepAu"] : undefined;

  return omitEmpty({
    id,
    name,
    kind: "star",
    systemId,
    parentId,
    facts: starFacts,
    color: starColorFromTeff(stTeff),
    meta: {
      source: parentId
        ? sepDerived
          ? "NASA Exoplanet Archive stellarhosts/pscomppars — companion projectedSepAu from angsep×distance; no invented binary orbit"
          : "NASA Exoplanet Archive Planetary Systems Composite Parameters (pscomppars) — companion star; no invented binary orbit"
        : "NASA Exoplanet Archive Planetary Systems Composite Parameters (pscomppars) — stellar mass/radius; orbit frame N/A (central star)",
      sources: [
        {
          name: `NASA Exoplanet Archive — ${name} overview`,
          url: ov,
          fields: [
            ...(starFacts.massKg != null ? ["facts.massKg"] : []),
            ...(starFacts.radiusMeanKm != null ? ["facts.radiusMeanKm"] : []),
            ...(discYear ? ["facts.discoveryDate"] : []),
            ...(sepDerived ? ["facts.projectedSepAu"] : []),
          ],
        },
      ],
      fetchedAt,
      confidence: sepDerived ? "assumed" : hasReal ? "known" : "assumed",
      approximateFields,
      unitsVersion: 1,
    },
  });
}

/**
 * Build one archive system from a family of hostnames (multi-star merge).
 * @param {string} familyName — stripped family key (display primary name)
 * @param {object[]} planetRows — all pscomppars rows for hostnames in the family
 * @param {string} fetchedAt
 * @param {object[]} [companionStarRows] — optional extra stellar rows (unused; siblings in planetRows suffice)
 */
function buildSystem(familyName, planetRows, fetchedAt, stellarHosts, stellarByFamily) {
  const systemId = kebabId(familyName);
  const hostnames = [...new Set(planetRows.map((r) => r.hostname).filter(Boolean))];
  // Fold in stellarhosts siblings so multi-star families get real companion cards + sep.
  const extra = stellarByFamily?.get(familyName) || [];
  for (const h of extra) hostnames.push(h);
  const uniqHosts = [...new Set(hostnames.filter(Boolean))];
  const primaryHostname = pickPrimaryHostname(uniqHosts, familyName);
  const ov = overviewUrl(primaryHostname || familyName);

  // Prefer a row from the primary hostname for system-level fields
  const primaryRows = planetRows.filter((r) => r.hostname === primaryHostname);
  const first = primaryRows[0] || planetRows[0];
  if (!first) return null;

  const syPnum = num(first.sy_pnum);
  let sySnum = num(first.sy_snum);
  for (const r of planetRows) {
    const s = num(r.sy_snum);
    if (s != null && (sySnum == null || s > sySnum)) sySnum = s;
  }
  const starCount = sySnum != null && sySnum >= 1 ? Math.trunc(sySnum) : 1;

  let circumbinary = false;
  for (const r of planetRows) {
    const cb = num(r.cb_flag);
    if (cb === 1) {
      circumbinary = true;
      break;
    }
  }

  const distPc = num(first.sy_dist);
  const distanceLy =
    distPc != null ? Math.round(distPc * 3.26156 * 10) / 10 : undefined;
  // ICRS degrees from the same primary/first TAP row as sy_dist — never invent.
  const raRaw = num(first.ra);
  const decRaw = num(first.dec);
  const raDeg =
    raRaw != null && raRaw >= 0 && raRaw <= 360 ? raRaw : undefined;
  const decDeg =
    decRaw != null && decRaw >= -90 && decRaw <= 90 ? decRaw : undefined;
  const hostSpectralType = first.st_spectype || undefined;
  const discYear = first.disc_year
    ? String(Math.trunc(num(first.disc_year) ?? first.disc_year))
    : undefined;
  const discMethod = first.discoverymethod || undefined;

  // --- Planets (dedupe by pl_name AND body id; sort with null aAu last) ---
  // Family merge can yield "55 Cnc b" + "55 Cnc B b" → same letter → same body id.
  // Prefer primary-hostname rows, then rows with aAu, then with mass/radius.
  function planetRowScore(row) {
    let s = 0;
    if (row.hostname === primaryHostname) s += 100;
    const a = num(row.pl_orbsmax);
    if (a != null && a > 0) s += 40;
    if (num(row.pl_bmasse) != null) s += 10;
    if (num(row.pl_rade) != null) s += 10;
    if (num(row.pl_orbper) != null) s += 5;
    return s;
  }

  const sortedPlanets = [...planetRows].sort((a, b) => {
    const scoreDiff = planetRowScore(b) - planetRowScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    const aa = num(a.pl_orbsmax);
    const bb = num(b.pl_orbsmax);
    const aNull = aa == null || aa <= 0;
    const bNull = bb == null || bb <= 0;
    if (aNull !== bNull) return aNull ? 1 : -1;
    if (!aNull && !bNull && aa !== bb) return aa - bb;
    return String(a.pl_name || "").localeCompare(String(b.pl_name || ""));
  });

  const seenPlanetNames = new Set();
  const seenBodyIds = new Set();
  const planets = [];
  let pi = 0;
  let hasGas = false;

  for (const row of sortedPlanets) {
    const pname = row.pl_name || `${row.hostname} ${(row.pl_letter || "").trim()}`;
    if (seenPlanetNames.has(pname)) continue;
    seenPlanetNames.add(pname);

    const aAu = num(row.pl_orbsmax);
    const hasOrbit = aAu != null && aAu > 0;
    const letter =
      (row.pl_letter || "").trim().toLowerCase() ||
      kebabId(row.pl_name).split("-").pop();
    // Companion-host planets (e.g. 55 Cnc B b) must not collide with primary 55 Cnc b.
    const hostForId =
      row.hostname === primaryHostname
        ? systemId
        : systemIdForHostname(row.hostname);
    const bodyId = `${hostForId}-${letter}`;
    // Dedupe by body id across family host rows (true aliases only).
    if (seenBodyIds.has(bodyId)) continue;
    seenBodyIds.add(bodyId);
    const eRaw = num(row.pl_orbeccen);
    const iRaw = num(row.pl_orbincl);
    const wRaw = num(row.pl_orblper);
    const periodD = num(row.pl_orbper);
    const epochJd = num(row.pl_tranmid);
    const rEarth = num(row.pl_rade);
    const mEarth = num(row.pl_bmasse);
    if (planetLooksGas(mEarth, rEarth)) hasGas = true;

    const rowYear = row.disc_year
      ? String(Math.trunc(num(row.disc_year) ?? row.disc_year))
      : discYear;
    const rowMethod = row.discoverymethod || discMethod;
    const note = discoveryNote(rowYear, rowMethod);
    const facts = omitEmpty({
      massKg: mEarth != null && mEarth > 0 ? mEarth * M_EARTH_KG : undefined,
      radiusMeanKm:
        rEarth != null && rEarth > 0 ? rEarth * R_EARTH_KM : undefined,
      discoveryDate: rowYear,
      discoveryNotes: note,
    });

    // Skip entirely empty cards (no orbit and no facts)
    if (!hasOrbit && Object.keys(facts).length === 0) continue;

    const assumed = [];
    let orbit;
    let fields;
    if (hasOrbit) {
      const e = eRaw != null ? eRaw : (assumed.push("e"), 0);
      const iDeg = iRaw != null ? iRaw : (assumed.push("iDeg"), 90);
      const wDeg = wRaw != null ? wRaw : (assumed.push("wDeg"), 0);
      assumed.push("omDeg", "maDeg");
      // Companion-host planets: elements are relative to that star → parent frame (Arch).
      const onCompanion = row.hostname !== primaryHostname;
      orbit = omitEmpty({
        frame: onCompanion ? "parent" : "heliocentric",
        epochJd,
        aAu,
        e: Math.min(Math.max(e, 0), 0.999999),
        iDeg,
        omDeg: 0,
        wDeg,
        maDeg: 0,
        periodD: periodD != null && periodD > 0 ? periodD : undefined,
      });
      fields = [
        "orbit.aAu",
        "orbit.periodD",
        "orbit.e",
        "orbit.iDeg",
        "orbit.wDeg",
        "orbit.epochJd",
        "facts.massKg",
        "facts.radiusMeanKm",
        "facts.discoveryDate",
        "facts.discoveryNotes",
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
        if (f === "facts.discoveryDate") return rowYear != null;
        if (f === "facts.discoveryNotes") return note != null;
        return false;
      });
    } else {
      fields = [
        "facts.massKg",
        "facts.radiusMeanKm",
        "facts.discoveryDate",
        "facts.discoveryNotes",
      ].filter((f) => {
        if (f === "facts.massKg") return facts.massKg != null;
        if (f === "facts.radiusMeanKm") return facts.radiusMeanKm != null;
        if (f === "facts.discoveryDate") return rowYear != null;
        if (f === "facts.discoveryNotes") return note != null;
        return false;
      });
    }

    const hostForMeta = row.hostname || primaryHostname || familyName;
    const onCompanion = row.hostname !== primaryHostname;
    const parentStarId = onCompanion ? hostForId : undefined;
    const metaSource = hasOrbit
      ? onCompanion
        ? `NASA Exoplanet Archive pscomppars; orbit.frame=parent relative to companion host ${hostForMeta} (parentId=${parentStarId}). omDeg=0 and maDeg=0 assumed${assumed.length ? ` (also defaulted: ${assumed.filter((x) => x !== "omDeg" && x !== "maDeg").join(", ") || "none"})` : ""}.`
        : `NASA Exoplanet Archive pscomppars; orbit.frame=heliocentric relative to host ${hostForMeta} (not SSB). omDeg=0 and maDeg=0 assumed${assumed.length ? ` (also defaulted: ${assumed.filter((x) => x !== "omDeg" && x !== "maDeg").join(", ") || "none"})` : ""}.`
      : `NASA Exoplanet Archive pscomppars; no pl_orbsmax — orbit omitted.`;

    planets.push(
      omitEmpty({
        id: bodyId,
        name: row.pl_name || `${hostForMeta} ${letter}`,
        kind: "planet",
        systemId,
        parentId: parentStarId,
        facts,
        color: planetColor(pi),
        meta: {
          source: metaSource,
          sources: [
            {
              name: `NASA Exoplanet Archive — ${hostForMeta} overview`,
              url: overviewUrl(hostForMeta),
              fields,
            },
          ],
          fetchedAt,
          confidence: hasOrbit ? "assumed" : "known",
          unitsVersion: 1,
        },
        ...(orbit ? { orbit } : {}),
      }),
    );
    pi++;
  }

  if (planets.length === 0) return null;

  // --- Stars ---
  const stars = [];
  const usedStarIds = new Set();

  // Primary star
  const primaryStarId = systemId;
  const primaryRow =
    mergeStarRow(primaryHostname, primaryRows.length ? primaryRows : planetRows, stellarHosts) ||
    primaryRows[0] ||
    first;
  stars.push(
    buildStarBody({
      id: primaryStarId,
      name: primaryHostname || familyName,
      systemId,
      row: primaryRow,
      fetchedAt,
      ov,
      discYear,
      discMethod,
      placeholder: false,
    }),
  );
  usedStarIds.add(primaryStarId);

  // Archive-backed companions: pscomppars siblings + stellarhosts family siblings
  const companionHosts = [...new Set(uniqHosts)]
    .filter((h) => h !== primaryHostname)
    .sort((a, b) => a.localeCompare(b));

  for (const compHostname of companionHosts) {
    if (stars.length >= starCount) break;
    const letter = companionLetter(compHostname);
    let compId;
    if (letter) {
      compId = `${systemId}-comp-${letter.toLowerCase()}`;
    } else {
      compId = systemIdForHostname(compHostname);
      // Avoid colliding with primary
      if (compId === primaryStarId) {
        compId = `${systemId}-comp-${kebabId(compHostname).slice(-4) || "x"}`;
      }
    }
    if (usedStarIds.has(compId)) continue;
    const compRow = mergeStarRow(compHostname, planetRows, stellarHosts);
    if (!compRow) continue;
    const sepAu = projectedSepAuFromCoords(primaryRow, compRow);
    stars.push(
      buildStarBody({
        id: compId,
        name: compHostname,
        systemId,
        row: compRow,
        fetchedAt,
        ov: overviewUrl(compHostname),
        discYear,
        discMethod,
        placeholder: false,
        parentId: primaryStarId,
        projectedSepAu: sepAu,
      }),
    );
    usedStarIds.add(compId);
  }

  // Placeholders for remaining sy_snum slots
  let placeholderIdx = 1;
  while (stars.length < starCount) {
    const id = `${systemId}-star-${placeholderIdx}`;
    placeholderIdx++;
    if (usedStarIds.has(id)) continue;
    stars.push(
      buildStarBody({
        id,
        name: `${familyName} companion`,
        systemId,
        row: null,
        fetchedAt,
        ov,
        discYear,
        discMethod,
        placeholder: true,
        parentId: primaryStarId,
      }),
    );
    usedStarIds.add(id);
  }

  const memberIds = [
    ...new Set([...stars.map((s) => s.id), ...planets.map((p) => p.id)]),
  ];

  // Earliest planet discovery (for system blurb — not copied onto stars).
  let firstYear;
  let firstMethod;
  let firstYearNum = Infinity;
  for (const pl of planets) {
    const raw = pl.facts?.discoveryDate;
    if (!raw) continue;
    const ym = /^(\d{4})/.exec(String(raw));
    if (!ym) continue;
    const y = Number(ym[1]);
    if (!Number.isFinite(y) || y >= firstYearNum) continue;
    firstYearNum = y;
    firstYear = String(y);
    const notes = pl.facts?.discoveryNotes;
    const mm = notes && /\(([^)]+)\)\.?\s*$/.exec(String(notes).replace(/\s+/g, " ").trim());
    firstMethod = mm ? mm[1] : undefined;
  }

  const systemBlurb = buildSystemOverviewBlurb({
    name: familyName,
    spectral: hostSpectralType,
    planetCount: planets.length,
    starCount,
    distanceLy,
    firstYear,
    firstMethod,
  });
  const indexBlurb = buildIndexBlurb({
    spectral: hostSpectralType,
    planetCount: planets.length,
    starCount,
    distanceLy,
    firstYear,
  });


  const system = omitEmpty({
    id: systemId,
    name: familyName,
    home: false,
    memberIds,
    primaryStarId,
    starCount,
    circumbinary: circumbinary || undefined,
    blurb: systemBlurb,
    planetCount: planets.length,
    distanceLy,
    raDeg,
    decDeg,
    hostSpectralType,
    hasGas,
    meta: {
      confidence: "known",
      fetchedAt,
      sources: [
        {
          name: `NASA Exoplanet Archive — ${primaryHostname || familyName} overview`,
          url: ov,
          fields: [
            "blurb",
            "planetCount",
            "starCount",
            ...(distanceLy != null ? ["distanceLy"] : []),
            ...(raDeg != null ? ["raDeg"] : []),
            ...(decDeg != null ? ["decDeg"] : []),
            ...(hostSpectralType ? ["hostSpectralType"] : []),
            ...(circumbinary ? ["circumbinary"] : []),
          ],
        },
      ],
    },
  });

  return {
    systemId,
    hostname: familyName,
    graph: { system, bodies: [...stars, ...planets] },
    indexRow: omitEmpty({
      id: systemId,
      name: familyName,
      planetCount: planets.length,
      starCount,
      distanceLy,
      raDeg,
      decDeg,
      hostSpectralType,
      hasGas,
      circumbinary: circumbinary || undefined,
      blurb: indexBlurb,
      overviewUrl: ov,
      primaryStarId,
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
    list.sort((a, b) => {
      const aa = num(a.pl_orbsmax);
      const bb = num(b.pl_orbsmax);
      const aNull = aa == null;
      const bNull = bb == null;
      if (aNull !== bNull) return aNull ? 1 : -1;
      return (aa ?? 0) - (bb ?? 0);
    });
  }
  return map;
}

/** Merge planet rows from all hostnames sharing a family key. */
function groupByFamily(rows) {
  const map = new Map();
  for (const row of rows) {
    const h = row.hostname;
    if (!h) continue;
    const key = familyKey(h);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      const aa = num(a.pl_orbsmax);
      const bb = num(b.pl_orbsmax);
      const aNull = aa == null || aa <= 0;
      const bNull = bb == null || bb <= 0;
      if (aNull !== bNull) return aNull ? 1 : -1;
      if (!aNull && !bNull && aa !== bb) return aa - bb;
      return String(a.pl_name || "").localeCompare(String(b.pl_name || ""));
    });
  }
  return map;
}

async function verifyCensus(opts) {
  const minP = opts.minPlanets;
  console.log(
    `--verify (sy_pnum >= ${minP}; pl_orbsmax NOT required — planets without a still ingest)`,
  );

  const censusAdql = `select count(distinct hostname) as n from pscomppars where sy_pnum >= ${minP}`;
  const censusRows = await tapCsv(censusAdql);
  const censusHosts = Number(censusRows[0]?.n ?? censusRows[0]?.N ?? NaN);

  const withAAdql = `select count(distinct hostname) as n from pscomppars where sy_pnum >= ${minP} and pl_orbsmax is not null`;
  const withARows = await tapCsv(withAAdql);
  const censusWithA = Number(withARows[0]?.n ?? withARows[0]?.N ?? NaN);

  const withoutAAdql = `select count(distinct hostname) as n from pscomppars where sy_pnum >= ${minP} and pl_orbsmax is null`;
  const withoutARows = await tapCsv(withoutAAdql);
  const censusWithoutA = Number(withoutARows[0]?.n ?? withoutARows[0]?.N ?? NaN);

  const rows = await fetchRows({
    ...opts,
    all: opts.all || opts.limit === Number.POSITIVE_INFINITY,
  });
  const byFamily = groupByFamily(rows);
  const windowFamilies = byFamily.size;
  const rowCap =
    opts._rowCap ??
    (opts.all ? TAP_ROW_CAP_ALL : Math.max(opts.limit * 12, 200));

  let buildable = 0;
  let protectedHits = 0;
  let planetsWithA = 0;
  let planetsWithoutA = 0;
  for (const [familyName, planetRows] of byFamily) {
    const systemId = kebabId(familyName);
    if (PROTECTED_SYSTEM_IDS.has(systemId)) {
      protectedHits++;
      continue;
    }
    for (const r of planetRows) {
      const a = num(r.pl_orbsmax);
      if (a != null && a > 0) planetsWithA++;
      else planetsWithoutA++;
    }
    if (buildSystem(familyName, planetRows, new Date().toISOString()))
      buildable++;
  }

  console.log(
    JSON.stringify(
      {
        minPlanets: minP,
        tapRowCap: rowCap,
        planetRowsFetched: rows.length,
        distinctFamiliesInWindow: windowFamilies,
        buildableFamiliesInWindow: buildable,
        protectedFamiliesInWindow: protectedHits,
        planetRowsWithA: planetsWithA,
        planetRowsWithoutA: planetsWithoutA,
        neaDistinctHosts_sy_pnum: censusHosts,
        neaDistinctHosts_sy_pnum_with_a: censusWithA,
        neaDistinctHosts_sy_pnum_without_a: censusWithoutA,
        gapVsCensusHosts: Number.isFinite(censusHosts)
          ? censusHosts - windowFamilies
          : null,
        note: opts.all
          ? `TOP ${TAP_ROW_CAP_ALL} planet rows may miss hosts beyond the window; pagination not implemented yet. pl_orbsmax no longer required.`
          : `Bounded --limit uses TOP ${rowCap} planet rows then first N families. pl_orbsmax no longer required.`,
      },
      null,
      2,
    ),
  );
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

  const byFamily = groupByFamily(rows);
  let stellarHosts = new Map();
  let stellarByFamily = new Map();
  try {
    stellarHosts = await fetchStellarHostsByHostname();
    stellarByFamily = indexStellarHostsByFamily(stellarHosts);
    console.log(
      `stellarhosts multi-star rows (deduped hostnames): ${stellarHosts.size}`,
    );
  } catch (err) {
    console.warn(
      "stellarhosts fetch failed (projectedSepAu will be sparse):",
      err.message || err,
    );
  }

  const built = [];
  const skippedProtected = [];
  const skippedEmpty = [];

  // Split families so bounded --min-planets 1 smoke reserves slots for singles.
  const multiFamilies = [];
  const singleFamilies = [];
  for (const entry of byFamily) {
    const pnum = num(entry[1][0]?.sy_pnum);
    if (pnum != null && pnum <= 1) singleFamilies.push(entry);
    else multiFamilies.push(entry);
  }

  function tryBuild(familyName, planetRows) {
    const systemId = kebabId(familyName);
    const forced = opts.forceIds.has(systemId);
    if (PROTECTED_SYSTEM_IDS.has(systemId) && !forced) {
      skippedProtected.push(systemId);
      return null;
    }
    // Prefer complete-ish hosts in bounded mode (row window may truncate).
    if (!opts.all && !opts.hosts) {
      const expect = num(planetRows[0]?.sy_pnum);
      const uniq = new Set(planetRows.map((r) => r.pl_name).filter(Boolean)).size;
      if (expect != null && expect >= 2 && uniq < Math.min(expect, 2)) {
        // Too truncated — skip; later families / wider window may fill better.
        skippedEmpty.push(systemId + ":truncated");
        return null;
      }
    }
    const item = buildSystem(familyName, planetRows, fetchedAt, stellarHosts, stellarByFamily);
    if (!item) {
      skippedEmpty.push(systemId);
      return null;
    }
    return item;
  }

  if (opts.hosts) {
    for (const [familyName, planetRows] of byFamily) {
      const item = tryBuild(familyName, planetRows);
      if (item) built.push(item);
    }
  } else if (opts.minPlanets === 1 && Number.isFinite(opts.limit)) {
    const singleSlots = Math.min(
      singleFamilies.length,
      Math.max(15, Math.floor(opts.limit * 0.3)),
    );
    const multiSlots = opts.limit - singleSlots;
    for (const [familyName, planetRows] of multiFamilies) {
      if (built.length >= multiSlots) break;
      const item = tryBuild(familyName, planetRows);
      if (item) built.push(item);
    }
    let singlesBuilt = 0;
    for (const [familyName, planetRows] of singleFamilies) {
      if (singlesBuilt >= singleSlots) break;
      const item = tryBuild(familyName, planetRows);
      if (item) {
        built.push(item);
        singlesBuilt++;
      }
    }
    // If singles fell short, backfill from remaining multi.
    if (built.length < opts.limit) {
      for (const [familyName, planetRows] of multiFamilies) {
        if (built.length >= opts.limit) break;
        if (built.some((b) => b.hostname === familyName)) continue;
        const item = tryBuild(familyName, planetRows);
        if (item) built.push(item);
      }
    }
  } else {
    for (const [familyName, planetRows] of byFamily) {
      if (built.length >= opts.limit) break;
      const item = tryBuild(familyName, planetRows);
      if (item) built.push(item);
    }
  }

  if (opts.hosts) {
    // Preserve requested order when possible (match by family key)
    const order = new Map(
      opts.hosts.map((h, i) => [kebabId(familyKey(h)), i]),
    );
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

  let multiStarSystems = 0;
  let systemsWithProjectedSep = 0;
  let companionStarsWithSep = 0;
  for (const item of built) {
    const sc = item.graph?.system?.starCount ?? item.indexRow?.starCount ?? 1;
    if (sc >= 2) multiStarSystems++;
    let any = false;
    for (const b of item.graph?.bodies || []) {
      if (b.kind !== "star") continue;
      const sep = b.facts?.projectedSepAu;
      if (sep != null && sep > 0) {
        companionStarsWithSep++;
        any = true;
      }
    }
    if (any) systemsWithProjectedSep++;
  }
  console.log(
    `Built ${built.length} systems; skipped protected=${skippedProtected.length} empty=${skippedEmpty.length}`,
  );
  console.log(
    `projectedSepAu coverage: ${systemsWithProjectedSep}/${multiStarSystems} multi-star systems; ${companionStarsWithSep} companion star(s) with sep`,
  );

  if (opts.dryRun) {
    console.log(
      "Dry-run — no files written. Sample ids:",
      built
        .slice(0, 8)
        .map((b) => b.systemId)
        .join(", "),
    );
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
