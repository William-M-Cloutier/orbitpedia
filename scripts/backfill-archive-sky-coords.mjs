#!/usr/bin/env node
/**
 * Focused TAP patch: add raDeg/decDeg to smoke archive index + graphs only.
 * Does not rewrite orbits, blurbs, or other graph fields.
 *
 * Usage (repo root):
 *   node scripts/backfill-archive-sky-coords.mjs
 *   node scripts/backfill-archive-sky-coords.mjs --dry-run
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = existsSync(join(__dirname, "package.json"))
  ? __dirname
  : join(__dirname, "..");
const TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync";
const dryRun = process.argv.includes("--dry-run");
const useBulk = process.argv.includes("--bulk");
const ARCHIVE = useBulk
  ? join(ROOT, "public", "archive", "bulk")
  : join(ROOT, "public", "archive");
const INDEX_PATH = join(ARCHIVE, "systems.index.json");
const GRAPHS = join(ARCHIVE, "graphs");

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row = {};
    for (let c = 0; c < headers.length; c++) {
      let v = cols[c] ?? "";
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

function sqlStringList(names) {
  return names.map((n) => `'${String(n).replace(/'/g, "''")}'`).join(",");
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

function coordsFromRow(row) {
  const raRaw = num(row?.ra);
  const decRaw = num(row?.dec);
  const raDeg =
    raRaw != null && raRaw >= 0 && raRaw <= 360 ? raRaw : undefined;
  const decDeg =
    decRaw != null && decRaw >= -90 && decRaw <= 90 ? decRaw : undefined;
  if (raDeg == null || decDeg == null) return null;
  return { raDeg, decDeg };
}

/** Prefer a row with both RA/Dec; first wins among equals. */
function pickCoords(rows) {
  for (const r of rows) {
    const c = coordsFromRow(r);
    if (c) return c;
  }
  return null;
}

async function fetchCoordsByHostnames(names) {
  const map = new Map(); // hostname -> {raDeg,decDeg}
  const batchSize = 40;
  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize);
    const adql = `select hostname, ra, dec from pscomppars where hostname in (${sqlStringList(batch)})`;
    const rows = await tapCsv(adql);
    const byHost = new Map();
    for (const r of rows) {
      const h = r.hostname;
      if (!h) continue;
      if (!byHost.has(h)) byHost.set(h, []);
      byHost.get(h).push(r);
    }
    for (const [h, list] of byHost) {
      const c = pickCoords(list);
      if (c) map.set(h, c);
    }
  }
  return map;
}

function patchMetaFields(system, added) {
  if (!added.length) return;
  const meta = system.meta;
  if (!meta || !Array.isArray(meta.sources) || meta.sources.length === 0) {
    return;
  }
  const src = meta.sources[0];
  const fields = Array.isArray(src.fields) ? [...src.fields] : [];
  for (const f of added) {
    if (!fields.includes(f)) fields.push(f);
  }
  src.fields = fields;
}

function mainReport(stats) {
  console.log(JSON.stringify(stats, null, 2));
}

async function main() {
  if (!existsSync(INDEX_PATH)) {
    throw new Error(`missing ${INDEX_PATH}`);
  }
  const index = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  const systems = index.systems || [];
  const names = [...new Set(systems.map((s) => s.name).filter(Boolean))];
  // Also fetch curated showcase hosts (patch their JSON separately).
  const curatedHosts = ["TRAPPIST-1", "Kepler-11"];
  const allHosts = [...new Set([...names, ...curatedHosts])];

  console.log(`TAP coords for ${allHosts.length} hostnames…`);
  const byHost = await fetchCoordsByHostnames(allHosts);

  let patchedIndex = 0;
  let omittedIndex = 0;
  let patchedGraphs = 0;
  let omittedGraphs = 0;

  for (const row of systems) {
    const c = byHost.get(row.name) || null;
    if (!c) {
      omittedIndex++;
      delete row.raDeg;
      delete row.decDeg;
      continue;
    }
    row.raDeg = c.raDeg;
    row.decDeg = c.decDeg;
    patchedIndex++;

    const gPath = join(GRAPHS, `${row.id}.json`);
    if (!existsSync(gPath)) {
      omittedGraphs++;
      continue;
    }
    const graph = JSON.parse(readFileSync(gPath, "utf8"));
    const sys = graph.system;
    if (!sys) {
      omittedGraphs++;
      continue;
    }
    const added = [];
    if (sys.raDeg !== c.raDeg) added.push("raDeg");
    if (sys.decDeg !== c.decDeg) added.push("decDeg");
    sys.raDeg = c.raDeg;
    sys.decDeg = c.decDeg;
    patchMetaFields(sys, ["raDeg", "decDeg"]);
    if (!dryRun) {
      writeFileSync(gPath, `${JSON.stringify(graph, null, 2)}\n`);
    }
    patchedGraphs++;
  }

  if (!dryRun) {
    writeFileSync(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
  }

  // Curated showcase (not smoke archive)
  const curatedPatch = [];
  for (const [id, host] of [
    ["trappist-1", "TRAPPIST-1"],
    ["kepler-11", "Kepler-11"],
  ]) {
    const c = byHost.get(host);
    const path = join(ROOT, "src", "data", "systems", `${id}.json`);
    if (!c || !existsSync(path)) {
      curatedPatch.push({ id, host, ok: false });
      continue;
    }
    const sys = JSON.parse(readFileSync(path, "utf8"));
    sys.raDeg = c.raDeg;
    sys.decDeg = c.decDeg;
    patchMetaFields(sys, ["raDeg", "decDeg"]);
    // Also ensure second NEA source lists coords when present
    if (Array.isArray(sys.meta?.sources)) {
      for (const src of sys.meta.sources) {
        if (!Array.isArray(src.fields)) continue;
        for (const f of ["raDeg", "decDeg"]) {
          if (!src.fields.includes(f) && src.fields.includes("distanceLy")) {
            src.fields.push(f);
          }
        }
      }
    }
    if (!dryRun) {
      writeFileSync(path, `${JSON.stringify(sys, null, 2)}\n`);
    }
    curatedPatch.push({ id, host, ok: true, ...c });
  }

  mainReport({
    dryRun,
    archive: {
      total: systems.length,
      withCoords: patchedIndex,
      omitted: omittedIndex,
      graphsPatched: patchedGraphs,
      graphsMissingOrSkipped: omittedGraphs,
    },
    curated: curatedPatch,
    tapHits: byHost.size,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
