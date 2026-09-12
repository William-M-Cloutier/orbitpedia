#!/usr/bin/env node
/**
 * Orbitpedia first-slice — Celestrak GP JSON → Store B satellite cards.
 *
 * Source-locked: Celestrak GP (OMM JSON) via CATNR queries.
 * Never invents elements; skips a CATNR when required GP fields are missing.
 *
 * Usage (repo root):
 *   node scripts/ingest-celestrak-gp.mjs --dry-run
 *   node scripts/ingest-celestrak-gp.mjs --from-seed --dry-run
 *   node scripts/ingest-celestrak-gp.mjs --from-seed --write
 *   node scripts/ingest-celestrak-gp.mjs --catnr 25544,20580 --dry-run
 *   node scripts/ingest-celestrak-gp.mjs --with-tle --dry-run
 *
 * Default: first-slice five CATNRs, dry-run (print JSON to stdout).
 * Live fetch respects Celestrak usage (cache under /tmp; prefer --from-seed).
 *
 * Writes (with --write):
 *   src/data/bodies/<id>.json
 * Does NOT create the earth-sats system shell (Earth Sats lead owns that).
 *
 * Field map: docs/EARTH_SATS_INGEST.md
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT =
  basename(__dirname) === "scripts" ? join(__dirname, "..") : __dirname;
const BODIES_DIR = join(ROOT, "src", "data", "bodies");
const SEED_PATH = join(
  __dirname,
  "fixtures",
  "celestrak-gp-first-slice.json",
);
const CACHE_DIR = "/tmp/orbitpedia-celestrak-gp-cache";
/** Celestrak asks ≤1 identical-object download per ~2h update window. */
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

const AU_KM = 149_597_870.7;
/** Earth GM (km³/s²) — WGS-84 / conventional SGP4 companion value. */
const MU_EARTH_KM3_S2 = 398_600.4418;
const SEC_PER_DAY = 86_400;

const GP_URL = "https://celestrak.org/NORAD/elements/gp.php";
/** Browsable SATCAT table — cite this, never the raw JSON endpoint. */
const SATCAT_URL = (catnr) =>
  `https://celestrak.org/satcat/records.php?CATNR=${catnr}`;
const GP_DOCS_URL =
  "https://celestrak.org/NORAD/documentation/gp-data-formats.php";

/**
 * First-slice catalog: NORAD CATNR → Store B id / display defaults.
 * Curated owner/launchDate are optional overlays (not from GP); omit if unset.
 */
const FIRST_SLICE = [
  {
    catnr: 25544,
    id: "iss",
    name: "ISS (Zarya)",
    aliases: ["ISS", "International Space Station", "Zarya"],
    color: "#E8E8E8",
    group: "stations",
    facts: {
      owner: "International (NASA/Roscosmos/ESA/JAXA/CSA)",
      launchDate: "1998-11-20",
      discoveryNotes:
        "International Space Station — crewed laboratory in low Earth orbit.",
    },
  },
  {
    catnr: 20580,
    id: "hst",
    name: "Hubble Space Telescope",
    aliases: ["HST", "Hubble"],
    color: "#9BB7D4",
    group: "stations",
    facts: {
      owner: "NASA",
      launchDate: "1990-04-24",
      discoveryNotes: "NASA space telescope in low Earth orbit.",
    },
  },
  {
    catnr: 48274,
    id: "css-tianhe",
    name: "CSS Tianhe",
    aliases: ["Tianhe", "CSS", "China Space Station"],
    color: "#F0C27A",
    group: "stations",
    facts: {
      owner: "CMSA/CNSA",
      launchDate: "2021-04-29",
      discoveryNotes: "Tianhe core module of the China Space Station.",
    },
  },
  {
    catnr: 25994,
    id: "terra",
    name: "Terra",
    aliases: ["EOS AM-1"],
    color: "#6BCB77",
    group: "science",
    facts: {
      owner: "NASA",
      launchDate: "1999-12-18",
      discoveryNotes: "NASA Earth Observing System flagship (AM) satellite.",
    },
  },
  {
    catnr: 43013,
    id: "noaa-20",
    name: "NOAA-20",
    aliases: ["JPSS-1", "NOAA 20"],
    color: "#4D96FF",
    group: "weather",
    facts: {
      owner: "NOAA/NASA",
      launchDate: "2017-11-18",
      discoveryNotes: "NOAA/NASA Joint Polar Satellite System-1 (JPSS-1).",
    },
  },
  {
    catnr: 33591,
    id: "noaa-19",
    name: "NOAA-19",
    aliases: ["NOAA 19"],
    color: "#3A7BD5",
    group: "weather",
    facts: {
      owner: "NOAA",
      launchDate: "2009-02-06",
      discoveryNotes: "NOAA polar-orbiting weather satellite (POES).",
    },
  },
  {
    catnr: 37849,
    id: "suomi-npp",
    name: "Suomi NPP",
    aliases: ["NPP", "Suomi National Polar-orbiting Partnership"],
    color: "#5B9BD5",
    group: "weather",
    facts: {
      owner: "NASA/NOAA",
      launchDate: "2011-10-28",
      discoveryNotes: "NASA/NOAA Suomi National Polar-orbiting Partnership.",
    },
  },
  {
    catnr: 38771,
    id: "metop-b",
    name: "MetOp-B",
    aliases: ["MetOp-B", "METOP-B"],
    color: "#6BA3D8",
    group: "weather",
    facts: {
      owner: "EUMETSAT/ESA",
      launchDate: "2012-09-17",
      discoveryNotes: "EUMETSAT polar meteorological satellite (MetOp series).",
    },
  },
  {
    catnr: 43689,
    id: "metop-c",
    name: "MetOp-C",
    aliases: ["MetOp-C", "METOP-C"],
    color: "#7BB0E0",
    group: "weather",
    facts: {
      owner: "EUMETSAT/ESA",
      launchDate: "2018-11-07",
      discoveryNotes: "EUMETSAT polar meteorological satellite (MetOp series).",
    },
  },
  {
    catnr: 27424,
    id: "aqua",
    name: "Aqua",
    aliases: ["EOS PM-1", "AQUA"],
    color: "#2E86AB",
    group: "science",
    facts: {
      owner: "NASA",
      launchDate: "2002-05-04",
      discoveryNotes: "NASA Earth Observing System flagship (PM) satellite.",
    },
  },
  {
    catnr: 28376,
    id: "aura",
    name: "Aura",
    aliases: ["EOS Aura", "AURA"],
    color: "#3A9BC2",
    group: "science",
    facts: {
      owner: "NASA",
      launchDate: "2004-07-15",
      discoveryNotes: "NASA Earth Observing System atmospheric chemistry satellite.",
    },
  },
  {
    catnr: 39084,
    id: "landsat-8",
    name: "Landsat 8",
    aliases: ["LDCM", "LANDSAT 8"],
    color: "#88C057",
    group: "science",
    facts: {
      owner: "NASA/USGS",
      launchDate: "2013-02-11",
      discoveryNotes: "NASA/USGS Landsat 8 Earth-imaging satellite.",
    },
  },
  {
    catnr: 49260,
    id: "landsat-9",
    name: "Landsat 9",
    aliases: ["LANDSAT 9"],
    color: "#9AD06A",
    group: "science",
    facts: {
      owner: "NASA/USGS",
      launchDate: "2021-09-27",
      discoveryNotes: "NASA/USGS Landsat 9 Earth-imaging satellite.",
    },
  },
  {
    catnr: 39634,
    id: "sentinel-1a",
    name: "Sentinel-1A",
    aliases: ["S1A", "SENTINEL-1A"],
    color: "#C9A227",
    group: "science",
    facts: {
      owner: "ESA/Copernicus",
      launchDate: "2014-04-03",
      discoveryNotes: "ESA Copernicus Sentinel-1A C-band SAR satellite.",
    },
  },
  {
    catnr: 40697,
    id: "sentinel-2a",
    name: "Sentinel-2A",
    aliases: ["S2A", "SENTINEL-2A"],
    color: "#D4B03A",
    group: "science",
    facts: {
      owner: "ESA/Copernicus",
      launchDate: "2015-06-23",
      discoveryNotes: "ESA Copernicus Sentinel-2A optical Earth-observation satellite.",
    },
  },
  {
    catnr: 41335,
    id: "sentinel-3a",
    name: "Sentinel-3A",
    aliases: ["S3A", "SENTINEL-3A"],
    color: "#E0C04D",
    group: "science",
    facts: {
      owner: "ESA/EUMETSAT",
      launchDate: "2016-02-16",
      discoveryNotes: "ESA/EUMETSAT Copernicus Sentinel-3A ocean/land monitoring satellite.",
    },
  },
  {
    catnr: 43613,
    id: "icesat-2",
    name: "ICESat-2",
    aliases: ["ICESAT-2", "ICESat 2"],
    color: "#7EC8E3",
    group: "science",
    facts: {
      owner: "NASA",
      launchDate: "2018-09-15",
      discoveryNotes: "NASA Ice, Cloud and land Elevation Satellite-2 (laser altimeter).",
    },
  },
  {
    catnr: 54754,
    id: "swot",
    name: "SWOT",
    aliases: ["Surface Water and Ocean Topography"],
    color: "#4DB8D4",
    group: "science",
    facts: {
      owner: "NASA/CNES",
      launchDate: "2022-12-16",
      discoveryNotes: "NASA/CNES Surface Water and Ocean Topography mission.",
    },
  },
  {
    catnr: 29107,
    id: "cloudsat",
    name: "CloudSat",
    aliases: ["CLOUDSAT"],
    color: "#A8C5D4",
    group: "science",
    facts: {
      owner: "NASA/CSA",
      launchDate: "2006-04-28",
      discoveryNotes: "NASA/CSA cloud-profiling radar Earth science satellite.",
    },
  },
];

const DEFAULT_SYSTEM_ID = "earth-sats";
const DEFAULT_PARENT_ID = "earth-sats-earth";

// Minimal BodySchema mirror for dry-run validation (keep in sync with schema.ts).
const OrbitFrameSchema = z.enum([
  "heliocentric",
  "barycentric",
  "parent",
  "geocentric",
]);
const OrbitSchema = z
  .object({
    epochJd: z.number().optional(),
    aAu: z.number().positive(),
    aKm: z.number().positive().optional(),
    e: z.number().min(0).max(1),
    iDeg: z.number(),
    omDeg: z.number(),
    wDeg: z.number(),
    maDeg: z.number(),
    periodD: z.number().positive().optional(),
    qAu: z.number().positive().optional(),
    qKm: z.number().positive().optional(),
    frame: OrbitFrameSchema,
  })
  .superRefine((orbit, ctx) => {
    if (orbit.frame === "geocentric") {
      if (orbit.aKm == null || !(orbit.aKm > 0)) {
        ctx.addIssue({
          code: "custom",
          message: "geocentric orbit requires positive aKm",
          path: ["aKm"],
        });
      }
    }
  });
const BodySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum([
      "star",
      "planet",
      "dwarf_planet",
      "asteroid",
      "moon",
      "satellite",
    ]),
    systemId: z.string().min(1),
    parentId: z.string().min(1).optional(),
    aliases: z.array(z.string()).optional(),
    facts: z
      .object({
        owner: z.string().min(1).optional(),
        launchDate: z.string().min(1).optional(),
        expectedReentry: z.string().min(1).optional(),
        discoveryNotes: z.string().optional(),
        discoveryDate: z.string().optional(),
      })
      .passthrough()
      .default({}),
    orbit: OrbitSchema.optional(),
    color: z.string().optional(),
    noradCatId: z.number().int().positive().optional(),
    satellite: z
      .object({
        tle: z.tuple([z.string().min(1), z.string().min(1)]).optional(),
      })
      .strict()
      .optional(),
    meta: z
      .object({
        provenance: z.string().min(1).optional(),
        source: z.string().min(1).optional(),
        confidence: z.enum(["known", "assumed", "placeholder"]),
        sources: z
          .array(
            z.object({
              name: z.string(),
              url: z.string().url(),
              fields: z.array(z.string()).optional(),
            }),
          )
          .optional(),
        fetchedAt: z.string().optional(),
        unitsVersion: z.literal(1).optional(),
      })
      .superRefine((meta, ctx) => {
        if (!meta.provenance && !meta.source) {
          ctx.addIssue({
            code: "custom",
            message: "meta.provenance or meta.source required",
            path: ["provenance"],
          });
        }
      }),
  })
  .superRefine((body, ctx) => {
    if (body.parentId && body.parentId === body.id) {
      ctx.addIssue({
        code: "custom",
        message: "parentId must not equal id",
        path: ["parentId"],
      });
    }
    if (body.orbit?.frame === "geocentric" && !body.parentId) {
      ctx.addIssue({
        code: "custom",
        message: "geocentric orbit requires parentId (Earth central)",
        path: ["parentId"],
      });
    }
    if (body.kind === "satellite" && body.orbit && body.orbit.frame !== "geocentric") {
      ctx.addIssue({
        code: "custom",
        message: "satellite kind should use orbit.frame geocentric",
        path: ["orbit", "frame"],
      });
    }
  });

function parseArgs(argv) {
  const opts = {
    dryRun: true,
    write: false,
    fromSeed: false,
    withTle: false,
    systemId: DEFAULT_SYSTEM_ID,
    parentId: DEFAULT_PARENT_ID,
    catnrs: null,
    group: null,
    seedPath: SEED_PATH,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--write") {
      opts.write = true;
      opts.dryRun = false;
    }
    else if (a === "--from-seed") opts.fromSeed = true;
    else if (a === "--with-tle") opts.withTle = true;
    else if (a === "--system-id" && argv[i + 1]) opts.systemId = argv[++i];
    else if (a === "--parent-id" && argv[i + 1]) opts.parentId = argv[++i];
    else if (a === "--seed" && argv[i + 1]) {
      opts.seedPath = argv[++i];
      opts.fromSeed = true;
    } else if (a === "--catnr" && argv[i + 1]) {
      opts.catnrs = argv[++i]
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    } else if (a === "--group" && argv[i + 1]) {
      opts.group = argv[++i].trim();
    } else {
      console.error(`Unknown arg: ${a}`);
      opts.help = true;
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node scripts/ingest-celestrak-gp.mjs [options]

Options:
  --dry-run          Print cards as JSON (default)
  --write            Write src/data/bodies/<id>.json
  --from-seed        Use scripts/fixtures/celestrak-gp-first-slice.json
  --seed <path>      Custom seed JSON (implies --from-seed)
  --catnr a,b,...    Subset of NORAD catalog numbers
  --group name       Subset by curated group: stations|weather|science
  --with-tle         Also fetch FORMAT=2LE into satellite.tle (live only)
  --system-id <id>   Default: earth-sats
  --parent-id <id>   Default: earth-sats-earth
  --help             This help

Never invents orbital elements. Prefer --from-seed to avoid Celestrak rate limits.
See docs/EARTH_SATS_INGEST.md for the GP→card field map.
`);
}

/** Required GP/OMM fields for an honest geocentric Kepler card. */
const REQUIRED_GP = [
  "NORAD_CAT_ID",
  "EPOCH",
  "MEAN_MOTION",
  "ECCENTRICITY",
  "INCLINATION",
  "RA_OF_ASC_NODE",
  "ARG_OF_PERICENTER",
  "MEAN_ANOMALY",
];

function missingGpFields(rec) {
  const miss = [];
  for (const k of REQUIRED_GP) {
    const v = rec?.[k];
    if (v == null || v === "" || (typeof v === "number" && !Number.isFinite(v))) {
      miss.push(k);
    }
  }
  if (rec?.MEAN_MOTION != null && !(Number(rec.MEAN_MOTION) > 0)) {
    miss.push("MEAN_MOTION(<=0)");
  }
  if (rec?.ECCENTRICITY != null) {
    const e = Number(rec.ECCENTRICITY);
    if (!(e >= 0 && e <= 1)) miss.push("ECCENTRICITY(out of range)");
  }
  return miss;
}

/**
 * Semi-major axis (km) from mean motion (rev/day) via Kepler n²a³ = μ.
 * Uses Earth GM; GP mean elements are TEME/SGP4 mean — educational viz only.
 */
function aKmFromMeanMotion(meanMotionRevPerDay) {
  const nRadPerSec = (meanMotionRevPerDay * 2 * Math.PI) / SEC_PER_DAY;
  return Math.cbrt(MU_EARTH_KM3_S2 / (nRadPerSec * nRadPerSec));
}

/** ISO-8601 (no Z required; Celestrak EPOCH is UTC without zone) → JD. */
function epochToJd(epochIso) {
  const s = String(epochIso).trim();
  const withZ = /Z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s) ? s : `${s}Z`;
  const ms = Date.parse(withZ);
  if (!Number.isFinite(ms)) return null;
  return ms / 86_400_000 + 2_440_587.5;
}

function displayNameFromObjectName(objectName, fallback) {
  if (!objectName || typeof objectName !== "string") return fallback;
  const t = objectName.trim();
  if (!t) return fallback;
  // Prefer curated short name when OBJECT_NAME is noisy; keep OBJECT_NAME in aliases.
  return fallback;
}

function buildCard(meta, gp, opts, tleLines) {
  const miss = missingGpFields(gp);
  if (miss.length) {
    return { skip: true, reason: `missing/invalid GP fields: ${miss.join(", ")}` };
  }

  const e = Number(gp.ECCENTRICITY);
  const meanMotion = Number(gp.MEAN_MOTION);
  const aKmRaw = aKmFromMeanMotion(meanMotion);
  if (!(aKmRaw > 0) || !Number.isFinite(aKmRaw)) {
    return { skip: true, reason: "could not derive aKm from MEAN_MOTION" };
  }
  /** Match curated seed display precision (meters-level). */
  const aKm = Math.round(aKmRaw * 1000) / 1000;
  const aAu = aKm / AU_KM;
  const qKm = aKm * (1 - e);
  const qAu = qKm / AU_KM;
  const periodD = 1 / meanMotion;
  const epochJd = epochToJd(gp.EPOCH);
  if (epochJd == null) {
    return { skip: true, reason: `unparseable EPOCH: ${gp.EPOCH}` };
  }

  const fetchedAt =
    gp.fetchedAt ||
    (typeof gp.fetchedAt === "string" ? gp.fetchedAt : null) ||
    new Date().toISOString();

  const facts = {};
  if (meta.facts?.owner) facts.owner = meta.facts.owner;
  if (meta.facts?.launchDate) facts.launchDate = meta.facts.launchDate;
  if (meta.facts?.expectedReentry) {
    facts.expectedReentry = meta.facts.expectedReentry;
  }
  if (meta.facts?.discoveryNotes) facts.discoveryNotes = meta.facts.discoveryNotes;
  // Seed may carry expectedReentry: null — omit (never invent).

  const orbitFields = [
    "orbit.epochJd",
    "orbit.aKm",
    "orbit.aAu",
    "orbit.e",
    "orbit.iDeg",
    "orbit.omDeg",
    "orbit.wDeg",
    "orbit.maDeg",
    "orbit.periodD",
    "orbit.qKm",
    "orbit.qAu",
    "orbit.frame",
    "noradCatId",
  ];

  const card = {
    id: meta.id,
    name: displayNameFromObjectName(gp.OBJECT_NAME, meta.name),
    kind: "satellite",
    systemId: opts.systemId,
    parentId: opts.parentId,
    aliases: uniqueAliases(meta.aliases, gp.OBJECT_NAME, gp.OBJECT_ID),
    facts,
    color: meta.color,
    noradCatId: Number(gp.NORAD_CAT_ID),
    orbit: {
      frame: "geocentric",
      epochJd,
      aKm,
      aAu,
      e,
      iDeg: Number(gp.INCLINATION),
      omDeg: Number(gp.RA_OF_ASC_NODE),
      wDeg: Number(gp.ARG_OF_PERICENTER),
      maDeg: Number(gp.MEAN_ANOMALY),
      periodD,
      qKm,
      qAu,
    },
    meta: {
      provenance: `Celestrak GP OMM JSON fetched ${fetchedAt}: ${gp.sourceUrl || `${GP_URL}?CATNR=${meta.catnr}&FORMAT=JSON`}`,
      source: `Celestrak GP (OMM) NORAD ${meta.catnr}`,
      confidence: "known",
      unitsVersion: 1,
      fetchedAt,
      sources: [
        {
          name: "Celestrak NORAD GP elements",
          url: "https://celestrak.org/NORAD/elements/",
          fields: [
            "orbit.aKm",
            "orbit.aAu",
            "orbit.e",
            "orbit.iDeg",
            "orbit.omDeg",
            "orbit.wDeg",
            "orbit.maDeg",
            "orbit.periodD",
            "orbit.qKm",
            "orbit.qAu",
            "orbit.epochJd",
            "noradCatId",
            ...(tleLines ? ["satellite.tle"] : []),
          ],
        },
        {
          name: `Celestrak satcat CATNR=${meta.catnr}`,
          url: SATCAT_URL(meta.catnr),
          fields: ["facts.owner", "facts.launchDate", "name"],
        },
        {
          name: "Celestrak GP data formats",
          url: GP_DOCS_URL,
          fields: ["orbit.frame", "meta.provenance"],
        },
      ],
    },
  };

  if (tleLines && tleLines.length === 2) {
    card.satellite = { tle: [tleLines[0], tleLines[1]] };
  }

  // Drop empty facts object noise? Schema allows {}. Keep sparse facts only.
  if (Object.keys(card.facts).length === 0) {
    card.facts = {};
  }

  return { skip: false, card };
}

function uniqueAliases(base, objectName, objectId) {
  const out = [];
  const seen = new Set();
  for (const a of [...(base || []), objectName, objectId]) {
    if (!a || typeof a !== "string") continue;
    const t = a.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.length ? out : undefined;
}

function cachePath(catnr, format) {
  return join(CACHE_DIR, `${catnr}.${format}.txt`);
}

function readFreshCache(path) {
  if (!existsSync(path)) return null;
  const age = Date.now() - statSync(path).mtimeMs;
  if (age > CACHE_TTL_MS) return null;
  return readFileSync(path, "utf8");
}

function writeCache(path, body) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, "utf8");
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json,text/plain,*/*" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `HTTP ${res.status} for ${url}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }
  return res.text();
}

async function fetchGpJson(catnr) {
  const path = cachePath(catnr, "json");
  const cached = readFreshCache(path);
  let text = cached;
  if (!text) {
    const url = `${GP_URL}?CATNR=${catnr}&FORMAT=JSON`;
    text = await fetchText(url);
    writeCache(path, text);
  }
  const data = JSON.parse(text);
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`empty GP JSON for CATNR=${catnr}`);
  }
  const rec = data[0];
  rec.fetchedAt = new Date().toISOString();
  rec.sourceUrl = `${GP_URL}?CATNR=${catnr}&FORMAT=JSON`;
  return rec;
}

async function fetchTle2le(catnr) {
  const path = cachePath(catnr, "2le");
  const cached = readFreshCache(path);
  let text = cached;
  if (!text) {
    const url = `${GP_URL}?CATNR=${catnr}&FORMAT=2LE`;
    text = await fetchText(url);
    writeCache(path, text);
  }
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // 2LE: two lines starting with 1 / 2
  const l1 = lines.find((l) => l.startsWith("1 "));
  const l2 = lines.find((l) => l.startsWith("2 "));
  if (!l1 || !l2) return null;
  return [l1, l2];
}

function loadSeed(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`seed must be a JSON array: ${path}`);
  const byCat = new Map();
  for (const rec of raw) {
    const id = Number(rec.NORAD_CAT_ID);
    if (!Number.isFinite(id)) continue;
    byCat.set(id, rec);
  }
  return byCat;
}

function mergeSeedCuratedFacts(meta, gp) {
  // Prefer explicit FIRST_SLICE curated facts; fill gaps from seed.facts if present.
  const facts = { ...(meta.facts || {}) };
  const sf = gp.facts;
  if (sf && typeof sf === "object") {
    if (!facts.owner && sf.owner) facts.owner = sf.owner;
    if (!facts.launchDate && sf.launchDate) facts.launchDate = sf.launchDate;
    if (!facts.expectedReentry && sf.expectedReentry) {
      facts.expectedReentry = sf.expectedReentry;
    }
  }
  return { ...meta, facts };
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  let slice = FIRST_SLICE;
  if (opts.group) {
    const allowed = new Set(["stations", "weather", "science"]);
    if (!allowed.has(opts.group)) {
      console.error(`Unknown --group ${opts.group} (use stations|weather|science)`);
      process.exit(1);
    }
    slice = slice.filter((s) => s.group === opts.group);
  }
  if (opts.catnrs?.length) {
    slice = slice.filter((s) => opts.catnrs.includes(s.catnr));
  }

  if (!slice.length) {
    console.error("No matching first-slice entries for --catnr/--group");
    process.exit(1);
  }

  let seedMap = null;
  if (opts.fromSeed) {
    if (!existsSync(opts.seedPath)) {
      console.error(`Seed not found: ${opts.seedPath}`);
      process.exit(1);
    }
    seedMap = loadSeed(opts.seedPath);
    console.error(`Using seed: ${opts.seedPath} (${seedMap.size} records)`);
  }

  const cards = [];
  const skipped = [];

  for (const meta of slice) {
    let gp;
    try {
      if (seedMap) {
        gp = seedMap.get(meta.catnr);
        if (!gp) {
          skipped.push({ catnr: meta.catnr, id: meta.id, reason: "not in seed" });
          continue;
        }
      } else {
        gp = await fetchGpJson(meta.catnr);
      }
    } catch (err) {
      skipped.push({
        catnr: meta.catnr,
        id: meta.id,
        reason: String(err?.message || err),
      });
      continue;
    }

    const metaMerged = mergeSeedCuratedFacts(meta, gp);
    let tleLines = null;
    if (opts.withTle && !opts.fromSeed) {
      try {
        tleLines = await fetchTle2le(meta.catnr);
      } catch (err) {
        console.error(
          `warn: TLE fetch failed for ${meta.catnr}: ${err.message}`,
        );
      }
    }

    const result = buildCard(metaMerged, gp, opts, tleLines);
    if (result.skip) {
      skipped.push({ catnr: meta.catnr, id: meta.id, reason: result.reason });
      continue;
    }

    const parsed = BodySchema.safeParse(result.card);
    if (!parsed.success) {
      skipped.push({
        catnr: meta.catnr,
        id: meta.id,
        reason: `schema: ${parsed.error.message}`,
      });
      continue;
    }
    cards.push(parsed.data);
  }

  if (opts.write) {
    mkdirSync(BODIES_DIR, { recursive: true });
    for (const card of cards) {
      const path = join(BODIES_DIR, `${card.id}.json`);
      writeFileSync(path, `${JSON.stringify(card, null, 2)}\n`, "utf8");
      console.error(`wrote ${path}`);
    }
    console.error(
      `Wrote ${cards.length} body card(s). System shell not modified — ensure src/data/systems/${opts.systemId}.json lists memberIds before validate:catalog.`,
    );
  } else {
    console.log(JSON.stringify({ cards, skipped }, null, 2));
  }

  if (skipped.length) {
    console.error(`Skipped ${skipped.length}:`);
    for (const s of skipped) {
      console.error(`  - ${s.id || "?"} (CATNR ${s.catnr}): ${s.reason}`);
    }
  }

  console.error(
    `Done: ${cards.length} card(s), ${skipped.length} skipped. mode=${opts.write ? "write" : "dry-run"}`,
  );
  if (!cards.length) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
