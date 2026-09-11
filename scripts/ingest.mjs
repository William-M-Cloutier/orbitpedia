#!/usr/bin/env node
/**
 * Orbitpedia Store B solar ingest — reproducible one-shot.
 * Public HTTP only; no API keys / secrets.
 *
 * Usage (from repo root): node scripts/ingest.mjs
 * Writes: src/data/bodies/<id>.json + refreshes src/data/systems/solar.json
 * Cache/temp under /tmp (not committed).
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../src/data");
const BODIES_DIR = join(DATA_DIR, "bodies");
const SYSTEMS_DIR = join(DATA_DIR, "systems");
const PHYS_PAR_CACHE = join("/tmp", "orbitpedia-phys_par.html");
const OMITTED_OUT = join("/tmp", "orbitpedia-ingest-omitted.json");
const SYSTEM_ID = "solar";

const HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api";
/** Human-readable pages only in meta.sources (never raw API query URLs). */
const HORIZONS_APP = "https://ssd.jpl.nasa.gov/horizons/app.html";
const SATS_PHYS_PAR_URL = "https://ssd.jpl.nasa.gov/sats/phys_par.html";
const SBDB_LOOKUP = "https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/";
const SBDB = "https://ssd-api.jpl.nasa.gov/sbdb.api";
const PHYS_PAR_URL = "https://ssd.jpl.nasa.gov/planets/phys_par.html";
const G_SI = 6.6743e-11; // CODATA 2018
const EPOCH_J2000 = 2451545.0;
const FETCHED_AT = new Date().toISOString();

const COLORS = {
  sun: "#FDB813",
  mercury: "#B5B5B5",
  venus: "#E8CDA0",
  earth: "#6B93D6",
  mars: "#C1440E",
  jupiter: "#C88B3A",
  saturn: "#E4D191",
  uranus: "#7EC8E3",
  neptune: "#5B5DDF",
  pluto: "#C9B8A8",
  ceres: "#8A8A8A",
  vesta: "#A8A090",
  pallas: "#9A9590",
  hygiea: "#7A7A78",
};

const DISCOVERY = {
  sun: "Central star of the Solar System",
  mercury: "Known since antiquity",
  venus: "Known since antiquity",
  earth: "Home world",
  mars: "Known since antiquity",
  jupiter: "Known since antiquity",
  saturn: "Known since antiquity",
  uranus: "Discovered 1781 by William Herschel",
  neptune: "Discovered 1846 by Galle (Adams/Le Verrier prediction)",
  pluto:
    "Discovered 1930 by Clyde Tombaugh; reclassified dwarf planet 2006",
  ceres:
    "Discovered 1801 by Giuseppe Piazzi; also classified as dwarf planet",
  vesta: "Discovered 1807 by Heinrich Olbers",
  pallas: "Discovered 1802 by Heinrich Olbers",
  hygiea: "Discovered 1849 by Annibale de Gasparis",
};

const DISCOVERY_DATES = {
  uranus: "1781-03-13",
  neptune: "1846-09-23",
  pluto: "1930-02-18",
  ceres: "1801-01-01",
  pallas: "1802-03-28",
  vesta: "1807-03-29",
  hygiea: "1849-04-12",
};

const PLANETS = [
  { id: "mercury", name: "Mercury", kind: "planet", horizonId: "199" },
  { id: "venus", name: "Venus", kind: "planet", horizonId: "299" },
  { id: "earth", name: "Earth", kind: "planet", horizonId: "399", aliases: ["Terra"] },
  { id: "mars", name: "Mars", kind: "planet", horizonId: "499" },
  { id: "jupiter", name: "Jupiter", kind: "planet", horizonId: "599" },
  { id: "saturn", name: "Saturn", kind: "planet", horizonId: "699" },
  { id: "uranus", name: "Uranus", kind: "planet", horizonId: "799" },
  { id: "neptune", name: "Neptune", kind: "planet", horizonId: "899" },
  { id: "pluto", name: "Pluto", kind: "dwarf_planet", horizonId: "999" },
];

const ASTEROIDS = [
  { id: "ceres", name: "Ceres", kind: "asteroid", sbdbDes: "1", aliases: ["1 Ceres"] },
  { id: "vesta", name: "Vesta", kind: "asteroid", sbdbDes: "4", aliases: ["4 Vesta"] },
  { id: "pallas", name: "Pallas", kind: "asteroid", sbdbDes: "2", aliases: ["2 Pallas"] },
  { id: "hygiea", name: "Hygiea", kind: "asteroid", sbdbDes: "10", aliases: ["10 Hygiea"] },
];

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Parse first ELEMENTS row after $$SOE from Horizons text result. */
function parseHorizonsElements(resultText) {
  const soe = resultText.indexOf("$$SOE");
  const eoe = resultText.indexOf("$$EOE");
  if (soe < 0 || eoe < 0) throw new Error("Horizons ELEMENTS block missing $$SOE/$$EOE");
  const block = resultText.slice(soe, eoe);
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  // Expect: JD line, then EC/QR/IN, OM/W/Tp, N/MA/TA, A/AD/PR
  const jdLine = lines.find((l) => /^2451545/.test(l));
  if (!jdLine) throw new Error("J2000 epoch row not found in Horizons ELEMENTS");
  const idx = lines.indexOf(jdLine);
  const row = lines.slice(idx + 1, idx + 5).join(" ");
  // Label must not be preceded by another letter (avoids MA→A, IN→N, TA→A).
  const get = (key) => {
    const m = row.match(
      new RegExp(`(?<![A-Za-z])${key}\\s*=\\s*([+-]?[0-9.]+(?:[Ee][+-]?[0-9]+)?)`),
    );
    if (!m) throw new Error(`Missing Horizons element ${key} in: ${row.slice(0, 120)}`);
    return Number(m[1]);
  };
  return {
    epochJd: EPOCH_J2000,
    aAu: get("A"),
    e: get("EC"),
    iDeg: get("IN"),
    omDeg: get("OM"),
    wDeg: get("W"),
    maDeg: get("MA"),
    periodD: get("PR"),
  };
}

async function fetchHorizonsElements(horizonId, center = "500@10") {
  const params = new URLSearchParams({
    format: "json",
    COMMAND: `'${horizonId}'`,
    OBJ_DATA: "NO",
    MAKE_EPHEM: "YES",
    EPHEM_TYPE: "ELEMENTS",
    CENTER: `'${center}'`,
    START_TIME: "'JD2451545.0'",
    STOP_TIME: "'JD2451546.0'",
    STEP_SIZE: "'1d'",
    OUT_UNITS: "AU-D",
    REF_PLANE: "ECLIPTIC",
    REF_SYSTEM: "J2000",
  });
  const data = await fetchJson(`${HORIZONS}?${params}`);
  if (!data.result) throw new Error(`Horizons empty result for ${horizonId}: ${JSON.stringify(data).slice(0, 200)}`);
  return parseHorizonsElements(data.result);
}

async function fetchSunFacts() {
  const params = new URLSearchParams({
    format: "json",
    COMMAND: "10",
    OBJ_DATA: "YES",
    MAKE_EPHEM: "NO",
  });
  const data = await fetchJson(`${HORIZONS}?${params}`);
  const t = data.result;
  const num = (re) => {
    const m = t.match(re);
    if (!m) return undefined;
    return Number(m[1].replace(/,/g, ""));
  };
  // Mass, 10^24 kg = ~1988410  → kg
  const mass24 = num(/Mass,\s*10\^24\s*kg\s*=\s*~?\s*([0-9.]+)/i);
  const radius = num(/Vol\.\s*mean\s*radius,\s*km\s*=\s*([0-9.]+)/i)
    ?? num(/Solar radius \(IAU2015\)=\s*([0-9.]+)/i);
  const density = num(/Mean density,\s*g\/cm\^3\s*=\s*([0-9.]+)/i);
  const rot = num(/Adopted sid\.\s*rot\.\s*per\.\s*=\s*([0-9.]+)\s*d/i);
  if (!mass24 || !radius) throw new Error("Failed to parse Sun physical properties from Horizons");
  const facts = {
    massKg: mass24 * 1e24,
    radiusMeanKm: radius,
    discoveryNotes: DISCOVERY.sun,
  };
  if (density != null) facts.densityGcm3 = density;
  if (rot != null) facts.rotationPeriodD = rot;
  // Geometric albedo not meaningfully defined for the Sun in this context — omit
  return facts;
}

/** Strip HTML tags / refs and take first numeric token (may be negative). */
function firstNumber(cellHtml) {
  const text = cellHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = text.match(/([+-]?[0-9]+(?:\.[0-9]+)?(?:[Ee][+-]?[0-9]+)?)/);
  return m ? Number(m[1]) : undefined;
}

function parsePhysParTables(html) {
  // Split into planet table and dwarf table by looking for <b>Name</b> rows
  const rowRe = /<tr>\s*<td><b>([^<]+)<\/b><\/td>([\s\S]*?)<\/tr>/gi;
  const byName = {};
  let m;
  while ((m = rowRe.exec(html))) {
    const name = m[1].trim();
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let c;
    // skip name cell already consumed; parse remaining from m[2]
    while ((c = cellRe.exec(m[2]))) {
      cells.push(c[1]);
    }
    // cells: eqRad, meanRad, mass, density, rot, orbPer, V, albedo, g, vesc
    if (cells.length < 8) continue;
    byName[name] = {
      radiusMeanKm: firstNumber(cells[1]),
      massRaw: firstNumber(cells[2]),
      densityGcm3: firstNumber(cells[3]),
      rotationPeriodD: firstNumber(cells[4]),
      albedo: firstNumber(cells[7]),
    };
  }
  return byName;
}

async function loadPhysPar() {
  let html;
  if (existsSync(PHYS_PAR_CACHE)) {
    html = readFileSync(PHYS_PAR_CACHE, "utf8");
  } else {
    html = await fetchText(PHYS_PAR_URL);
    writeFileSync(PHYS_PAR_CACHE, html);
  }
  return parsePhysParTables(html);
}

function factsFromPhysPar(name, id, massScale) {
  const row = physPar[name];
  if (!row) throw new Error(`phys_par missing row for ${name}`);
  const facts = {
    massKg: row.massRaw * massScale,
    radiusMeanKm: row.radiusMeanKm,
    discoveryNotes: DISCOVERY[id],
  };
  if (row.densityGcm3 != null) facts.densityGcm3 = row.densityGcm3;
  if (row.rotationPeriodD != null) facts.rotationPeriodD = row.rotationPeriodD;
  if (row.albedo != null) facts.albedo = row.albedo;
  return facts;
}

function sbdbPhysMap(physParArr) {
  const map = {};
  for (const p of physParArr || []) map[p.name] = p;
  return map;
}

function asteroidFromSbdb(meta, data) {
  const els = Object.fromEntries(data.orbit.elements.map((e) => [e.name, e]));
  const need = ["a", "e", "i", "om", "w", "ma", "per"];
  for (const k of need) {
    if (!els[k]) throw new Error(`SBDB ${meta.sbdbDes} missing element ${k}`);
  }
  const epochJd = Number(data.orbit.epoch);
  const orbit = {
    epochJd,
    aAu: Number(els.a.value),
    e: Number(els.e.value),
    iDeg: Number(els.i.value),
    omDeg: Number(els.om.value),
    wDeg: Number(els.w.value),
    maDeg: Number(els.ma.value),
    periodD: Number(els.per.value),
  };

  const pp = sbdbPhysMap(data.phys_par);
  const facts = { discoveryNotes: DISCOVERY[meta.id] };

  if (pp.diameter?.value != null) {
    facts.radiusMeanKm = Number(pp.diameter.value) / 2;
  }
  if (pp.density?.value != null) {
    facts.densityGcm3 = Number(pp.density.value);
  }
  if (pp.albedo?.value != null) {
    facts.albedo = Number(pp.albedo.value);
  }
  if (pp.rot_per?.value != null) {
    // SBDB rot_per is hours → days
    facts.rotationPeriodD = Number(pp.rot_per.value) / 24;
  }
  if (pp.GM?.value != null) {
    const gmKm3 = Number(pp.GM.value); // km^3/s^2
    if (Number.isFinite(gmKm3) && gmKm3 > 0) {
      const gmM3 = gmKm3 * 1e9;
      facts.massKg = gmM3 / G_SI;
    }
  }

  // massKg + radiusMeanKm required by schema
  if (facts.massKg == null || facts.radiusMeanKm == null) {
    throw new Error(
      `SBDB ${meta.sbdbDes} missing required mass/radius (mass=${facts.massKg}, r=${facts.radiusMeanKm})`,
    );
  }

  const omitted = [];
  if (pp.density == null) omitted.push("densityGcm3");
  if (pp.albedo == null) omitted.push("albedo");
  if (pp.rot_per == null) omitted.push("rotationPeriodD");

  const sources = [
    {
      name: "JPL SBDB API",
      url: `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(meta.sbdbDes)}`,
      fields: [
        "orbit.aAu",
        "orbit.e",
        "orbit.iDeg",
        "orbit.omDeg",
        "orbit.wDeg",
        "orbit.maDeg",
        "orbit.periodD",
        "orbit.epochJd",
        "facts.radiusMeanKm",
        "facts.massKg",
        ...(facts.densityGcm3 != null ? ["facts.densityGcm3"] : []),
        ...(facts.albedo != null ? ["facts.albedo"] : []),
        ...(facts.rotationPeriodD != null ? ["facts.rotationPeriodD"] : []),
        "sbdbDes",
      ],
    },
  ];

  if (DISCOVERY_DATES[meta.id]) facts.discoveryDate = DISCOVERY_DATES[meta.id];
  facts.discoveryNotes = DISCOVERY[meta.id];

  return {
    body: {
      id: meta.id,
      name: meta.name,
      kind: meta.kind,
      systemId: SYSTEM_ID,
      aliases: meta.aliases,
      facts,
      orbit: { ...orbit, frame: "heliocentric" },
      color: COLORS[meta.id],
      sbdbDes: meta.sbdbDes,
      meta: {
        source: "JPL SBDB (full-prec + phys-par)",
        sources,
        fetchedAt: FETCHED_AT,
        confidence: "known",
        unitsVersion: 1,
      },
    },
    omitted,
  };
}

let physPar;

async function main() {
  console.log("Fetching phys_par…");
  physPar = await loadPhysPar();
  console.log("phys_par bodies:", Object.keys(physPar).join(", "));

  const bodies = [];
  const notesOmitted = [];

  // Sun
  console.log("Fetching Sun (Horizons OBJ_DATA)…");
  const sunFacts = await fetchSunFacts();
  sunFacts.discoveryNotes = DISCOVERY.sun;
  bodies.push({
    id: "sun",
    name: "Sun",
    kind: "star",
    systemId: SYSTEM_ID,
    aliases: ["Sol"],
    facts: sunFacts,
    color: COLORS.sun,
    horizonId: "10",
    meta: {
      source: "JPL Horizons Sun physical properties (IAU2015 radius)",
      sources: [
        {
          name: "JPL Horizons web app",
          url: HORIZONS_APP,
          fields: [
            "facts.massKg",
            "facts.radiusMeanKm",
            "facts.densityGcm3",
            "facts.rotationPeriodD",
            "horizonId",
          ],
        },
      ],
      fetchedAt: FETCHED_AT,
      confidence: "known",
      unitsVersion: 1,
    },
  });
  notesOmitted.push({
    id: "sun",
    fields: ["facts.albedo", "orbit"],
    why: "Albedo not applicable/meaningful for the Sun in Horizons phys block; star has no heliocentric orbit.",
  });

  // Planets + Pluto
  for (const p of PLANETS) {
    console.log(`Fetching ${p.name} orbit (Horizons ${p.horizonId})…`);
    const orbit = await fetchHorizonsElements(p.horizonId);
    await sleep(250); // be polite to SSD

    const massScale = p.id === "pluto" ? 1e18 : 1e24; // phys_par dwarf mass ×10^18 kg
    const physName = p.name;
    const facts = factsFromPhysPar(physName, p.id, massScale);

    facts.discoveryNotes = DISCOVERY[p.id];
    if (DISCOVERY_DATES[p.id]) facts.discoveryDate = DISCOVERY_DATES[p.id];

    const body = {
      id: p.id,
      name: p.name,
      kind: p.kind,
      systemId: SYSTEM_ID,
      ...(p.aliases ? { aliases: p.aliases } : {}),
      facts,
      orbit: { ...orbit, frame: "heliocentric" },
      color: COLORS[p.id],
      horizonId: p.horizonId,
      meta: {
        source: "JPL Horizons + SSD phys_par",
        sources: [
          {
            name: "JPL Horizons web app",
            url: HORIZONS_APP,
            fields: [
              "orbit.epochJd",
              "orbit.aAu",
              "orbit.e",
              "orbit.iDeg",
              "orbit.omDeg",
              "orbit.wDeg",
              "orbit.maDeg",
              "orbit.periodD",
              "orbit.frame",
              "horizonId",
            ],
          },
          {
            name: "JPL SSD Planetary Physical Parameters",
            url: PHYS_PAR_URL,
            fields: [
              "facts.massKg",
              "facts.radiusMeanKm",
              "facts.densityGcm3",
              "facts.rotationPeriodD",
              "facts.albedo",
            ],
          },
        ],
        fetchedAt: FETCHED_AT,
        confidence: "known",
        unitsVersion: 1,
      },
    };
    bodies.push(body);

    if (p.id === "earth") {
      console.log("Fetching Moon orbit (Horizons 301 vs Earth)…");
      const moonOrbit = await fetchHorizonsElements("301", "500@399");
      await sleep(250);
      const moonFacts = {
        massKg: 7.349e22,
        radiusMeanKm: 1737.53,
        densityGcm3: 3.3437,
        rotationPeriodD: 27.321661,
        albedo: 0.12,
        discoveryNotes: "Known since antiquity",
      };
      bodies.push({
        id: "moon",
        name: "Moon",
        kind: "moon",
        systemId: SYSTEM_ID,
        parentId: "earth",
        aliases: ["Luna"],
        facts: moonFacts,
        orbit: { ...moonOrbit, frame: "parent" },
        color: "#C8C8C8",
        horizonId: "301",
        meta: {
          source: "JPL Horizons Moon vs Earth (ELEMENTS + OBJ_DATA)",
          sources: [
            {
              name: "JPL Horizons web app",
              url: HORIZONS_APP,
              fields: [
                "orbit.epochJd",
                "orbit.aAu",
                "orbit.e",
                "orbit.iDeg",
                "orbit.omDeg",
                "orbit.wDeg",
                "orbit.maDeg",
                "orbit.periodD",
                "orbit.frame",
                "horizonId",
              ],
            },
            {
              name: "JPL SSD satellite physical parameters",
              url: SATS_PHYS_PAR_URL,
              fields: [
                "facts.massKg",
                "facts.radiusMeanKm",
                "facts.densityGcm3",
                "facts.albedo",
                "facts.rotationPeriodD",
              ],
            },
          ],
          fetchedAt: FETCHED_AT,
          confidence: "known",
          unitsVersion: 1,
        },
      });
    }
  }

  // Asteroids
  for (const a of ASTEROIDS) {
    console.log(`Fetching ${a.name} (SBDB des=${a.sbdbDes})…`);
    const url = `${SBDB}?des=${encodeURIComponent(a.sbdbDes)}&phys-par=true&full-prec=true`;
    const data = await fetchJson(url);
    if (data.code || !data.orbit) {
      throw new Error(`SBDB error for ${a.sbdbDes}: ${JSON.stringify(data).slice(0, 300)}`);
    }
    const { body, omitted } = asteroidFromSbdb(a, data);
    bodies.push(body);
    if (omitted.length) {
      notesOmitted.push({
        id: a.id,
        fields: omitted,
        why: "Not present in SBDB phys-par response; omitted rather than fabricated.",
      });
    }
    await sleep(150);
  }

  mkdirSync(BODIES_DIR, { recursive: true });
  mkdirSync(SYSTEMS_DIR, { recursive: true });

  for (const body of bodies) {
    const path = join(BODIES_DIR, `${body.id}.json`);
    writeFileSync(path, JSON.stringify(body, null, 2) + "\n");
  }

  const system = {
    id: SYSTEM_ID,
    name: "Solar System",
    home: true,
    memberIds: bodies.map((b) => b.id),
  };
  writeFileSync(
    join(SYSTEMS_DIR, `${SYSTEM_ID}.json`),
    JSON.stringify(system, null, 2) + "\n",
  );

  writeFileSync(
    OMITTED_OUT,
    JSON.stringify({ fetchedAt: FETCHED_AT, omitted: notesOmitted }, null, 2) + "\n",
  );
  const gen = spawnSync(
    process.execPath,
    [join(__dirname, "generate-catalog-index.mjs")],
    { stdio: "inherit" },
  );
  if (gen.status !== 0) {
    throw new Error("generate-catalog-index.mjs failed");
  }

  console.log(`Wrote ${bodies.length} body cards under ${BODIES_DIR}`);
  console.log(`Wrote ${join(SYSTEMS_DIR, SYSTEM_ID + ".json")}`);
  console.log(`Omitted log: ${OMITTED_OUT}`);
  console.log("Omitted fields:", JSON.stringify(notesOmitted, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});