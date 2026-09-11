#!/usr/bin/env node
/**
 * Catalog sanity + schema validation for Orbitpedia.
 *
 * Usage (from repo root):
 *   node scripts/validate-catalog.mjs
 *   node scripts/validate-catalog.mjs --catalog src/data/catalog/bodies.json
 *   node scripts/validate-catalog.mjs --central-body sun
 *   node scripts/validate-catalog.mjs --central-radius-au 0.00465
 *   node scripts/validate-catalog.mjs --strict-warnings
 *
 * --central-radius-au makes this reusable for non-solar systems (pass the
 * central body's physical radius in au). If omitted, radius is taken from the
 * central body's facts.radiusMeanKm in the catalog.
 *
 * Orbit clearance uses EPS_AU=1e-9 (same as scripts/orbit-sanity.mjs).
 *
 * Zod shapes below must stay in sync with src/data/schema.ts until scripts can
 * import TypeScript directly (tracked follow-up: share one schema module).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const AU_KM = 149_597_870.7;
/** Match scripts/orbit-sanity.mjs — float compare margin (au). */
const EPS_AU = 1e-9;
const HERE = dirname(fileURLToPath(import.meta.url));

const BodyKindSchema = z.enum(["star", "planet", "dwarf_planet", "asteroid"]);
const OrbitSchema = z.object({
  epochJd: z.number(),
  aAu: z.number().positive(),
  e: z.number().min(0).max(1),
  iDeg: z.number(),
  omDeg: z.number(),
  wDeg: z.number(),
  maDeg: z.number(),
  periodD: z.number().positive().optional(),
  qAu: z.number().positive().optional(),
});
const FactsSchema = z.object({
  massKg: z.number().positive(),
  radiusMeanKm: z.number().positive(),
  densityGcm3: z.number().positive().optional(),
  rotationPeriodD: z.number().optional(),
  albedo: z.number().min(0).max(1).optional(),
  discoveryNotes: z.string().optional(),
});
const BodyMetaSchema = z.object({
  source: z.string(),
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
  unitsVersion: z.literal(1),
});
const BodySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: BodyKindSchema,
  aliases: z.array(z.string()).optional(),
  facts: FactsSchema,
  orbit: OrbitSchema.optional(),
  color: z.string().optional(),
  horizonId: z.string().optional(),
  sbdbDes: z.string().optional(),
  meta: BodyMetaSchema,
});
const CatalogSchema = z.object({
  version: z.literal(1),
  bodies: z.array(BodySchema).min(1),
});

function parseArgs(argv) {
  const out = {
    catalog: null,
    centralBody: null,
    centralRadiusAu: null,
    strictWarnings: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--catalog") out.catalog = argv[++i];
    else if (a === "--central-body") out.centralBody = argv[++i];
    else if (a === "--central-radius-au") out.centralRadiusAu = Number(argv[++i]);
    else if (a === "--strict-warnings") out.strictWarnings = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function periapsisAu(orbit) {
  if (orbit.qAu != null && Number.isFinite(orbit.qAu)) return orbit.qAu;
  return orbit.aAu * (1 - orbit.e);
}

function resolveCatalogPath(argPath) {
  if (argPath) return resolve(process.cwd(), argPath);
  // Prefer repo layout when run from repo root or from scripts/
  const candidates = [
    resolve(process.cwd(), "src/data/catalog/bodies.json"),
    resolve(HERE, "../src/data/catalog/bodies.json"),
    resolve(HERE, "bodies.json"), // legacy local copy next to script
  ];
  return candidates[0];
}

function findCentralBody(bodies, idHint) {
  if (idHint) {
    const hit = bodies.find((b) => b.id === idHint);
    if (!hit) throw new Error(`central body id not found: ${idHint}`);
    return hit;
  }
  return bodies.find((b) => b.kind === "star") ?? bodies.find((b) => b.id === "sun");
}

function collectWeakFieldFlags(body, centralId) {
  const flags = [];
  if (!body.meta.sources?.length) flags.push("meta.sources missing");
  if (!body.meta.fetchedAt) flags.push("meta.fetchedAt missing");
  if (body.id !== centralId && !body.orbit) flags.push("orbit missing (non-central)");
  if (body.orbit && body.id !== centralId) {
    if (!body.horizonId && !body.sbdbDes) flags.push("horizonId/sbdbDes missing");
  }
  if (body.kind === "star" && !body.horizonId) flags.push("horizonId missing (star)");
  if (body.facts.densityGcm3 == null && body.kind !== "star") {
    flags.push("facts.densityGcm3 missing");
  }
  if (body.facts.albedo == null && body.kind !== "star") {
    flags.push("facts.albedo missing");
  }
  if (body.orbit) {
    const q = periapsisAu(body.orbit);
    if (!(q > 0)) flags.push("periapsis qAu not positive");
  }
  return flags;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node scripts/validate-catalog.mjs [options]
  --catalog <path>           default: src/data/catalog/bodies.json
  --central-body <id>        default: first kind=star (else sun)
  --central-radius-au <n>    override central radius (au); else from catalog
  --strict-warnings          exit 1 if any weak-field flags`);
  process.exit(0);
}

const catalogPath = resolveCatalogPath(args.catalog);
let raw;
try {
  raw = JSON.parse(readFileSync(catalogPath, "utf8"));
} catch (err) {
  console.error(`VALIDATION FAIL: cannot read catalog at ${catalogPath}`);
  console.error(String(err));
  process.exit(1);
}

const parsed = CatalogSchema.safeParse(raw);
if (!parsed.success) {
  console.error("VALIDATION FAIL (schema)");
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

const { bodies, version } = parsed.data;
const central = findCentralBody(bodies, args.centralBody);
if (!central) {
  console.error("VALIDATION FAIL: no central body (star) found; pass --central-body");
  process.exit(1);
}

const centralRadiusAu =
  args.centralRadiusAu != null && Number.isFinite(args.centralRadiusAu)
    ? args.centralRadiusAu
    : central.facts.radiusMeanKm / AU_KM;

if (!(centralRadiusAu > 0)) {
  console.error("VALIDATION FAIL: central body radius must be positive");
  process.exit(1);
}

const hardErrors = [];
const warnings = [];

for (const b of bodies) {
  if (b.id === central.id) continue;
  if (!b.orbit) {
    hardErrors.push(`${b.id}: missing orbit while not central body`);
    continue;
  }
  const q = periapsisAu(b.orbit);
  if (!(q > centralRadiusAu + EPS_AU)) {
    hardErrors.push(
      `${b.id}: periapsis q=${q.toPrecision(8)} au does not clear central '${central.id}' radius ${centralRadiusAu.toPrecision(8)} au (intersects or subsurface)`,
    );
  }
  for (const f of collectWeakFieldFlags(b, central.id)) {
    warnings.push(`${b.id}: ${f}`);
  }
}
for (const f of collectWeakFieldFlags(central, central.id)) {
  warnings.push(`${central.id}: ${f}`);
}

console.log("catalog", catalogPath);
console.log("version", version);
console.log("bodies", bodies.length);
console.log(
  `central ${central.id} radiusMeanKm=${central.facts.radiusMeanKm} radiusAu=${centralRadiusAu}`,
);

if (hardErrors.length) {
  console.error("VALIDATION FAIL (orbit clearance)");
  for (const e of hardErrors) console.error(`  - ${e}`);
  if (warnings.length) {
    console.error("weak-field flags:");
    for (const w of warnings) console.error(`  - ${w}`);
  }
  process.exit(1);
}

if (warnings.length) {
  console.log("WEAK FIELD FLAGS", warnings.length);
  for (const w of warnings) console.log(`  - ${w}`);
  if (args.strictWarnings) {
    console.error("VALIDATION FAIL (--strict-warnings)");
    process.exit(1);
  }
} else {
  console.log("WEAK FIELD FLAGS 0");
}

console.log("VALIDATION PASS");
console.log(
  "orbit_clearance_ok true (all orbiters qAu|a*(1-e) > central radius)",
);