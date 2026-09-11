#!/usr/bin/env node
/**
 * Catalog sanity + schema validation for Orbitpedia (Store B / catalog v2).
 *
 * Usage (from repo root):
 *   node scripts/validate-catalog.mjs
 *   node scripts/validate-catalog.mjs --data-dir src/data
 *   node scripts/validate-catalog.mjs --central-body sun
 *   node scripts/validate-catalog.mjs --central-radius-au 0.00465
 *   node scripts/validate-catalog.mjs --strict-warnings
 *   node scripts/validate-catalog.mjs --system solar
 *
 * Loads src/data/systems/*.json + src/data/bodies/*.json (Store B).
 * Zod shapes below must stay in sync with src/data/schema.ts until scripts can
 * import TypeScript directly (tracked follow-up: share one schema module).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const AU_KM = 149_597_870.7;
/** Match scripts/orbit-sanity.mjs — float compare margin (au). */
const EPS_AU = 1e-9;
const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG_VERSION = 2;

const BodyKindSchema = z.enum([
  "star",
  "planet",
  "dwarf_planet",
  "asteroid",
  "moon",
]);
const OrbitFrameSchema = z.enum(["heliocentric", "barycentric", "parent"]);
const ConfidenceSchema = z.enum(["known", "assumed", "placeholder"]);
const OrbitSchema = z.object({
  epochJd: z.number().optional(),
  aAu: z.number().positive(),
  e: z.number().min(0).max(1),
  iDeg: z.number(),
  omDeg: z.number(),
  wDeg: z.number(),
  maDeg: z.number(),
  periodD: z.number().positive().optional(),
  qAu: z.number().positive().optional(),
  frame: OrbitFrameSchema,
});
const FactsSchema = z.object({
  massKg: z.number().positive().optional(),
  radiusMeanKm: z.number().positive().optional(),
  densityGcm3: z.number().positive().optional(),
  rotationPeriodD: z.number().optional(),
  albedo: z.number().min(0).max(2).optional(), // geometric albedo can exceed 1 (e.g. Enceladus)
  discoveryNotes: z.string().optional(),
  discoveryDate: z.string().optional(),
});
const BodyMetaSchema = z
  .object({
    provenance: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
    confidence: ConfidenceSchema,
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
  });
const BodySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: BodyKindSchema,
  systemId: z.string().min(1),
  parentId: z.string().min(1).optional(),
  aliases: z.array(z.string()).optional(),
  facts: FactsSchema.default({}),
  orbit: OrbitSchema.optional(),
  color: z.string().optional(),
  horizonId: z.string().optional(),
  sbdbDes: z.string().optional(),
  meta: BodyMetaSchema,
});
const SystemMetaSchema = z.object({
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
  confidence: ConfidenceSchema.optional(),
});
const SystemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  home: z.boolean().optional(),
  memberIds: z.array(z.string().min(1)).min(1),
  placeholderPrimaryId: z.string().min(1).optional(),
  blurb: z.string().min(1).optional(),
  highlights: z.array(z.string().min(1)).optional(),
  planetCount: z.number().int().nonnegative().optional(),
  distanceLy: z.number().nonnegative().optional(),
  hostSpectralType: z.string().min(1).optional(),
  compactnessNote: z.string().min(1).optional(),
  meta: SystemMetaSchema.optional(),
});
const CatalogSchema = z
  .object({
    version: z.literal(CATALOG_VERSION),
    systems: z.array(SystemSchema).min(1),
    bodies: z.array(BodySchema).min(1),
  })
  .superRefine((cat, ctx) => {
    const systemIds = new Set(cat.systems.map((s) => s.id));
    const bodyIds = new Set(cat.bodies.map((b) => b.id));
    const homes = cat.systems.filter((s) => s.home === true);
    if (homes.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: `exactly one home system required (found ${homes.length})`,
        path: ["systems"],
      });
    }
    for (const s of cat.systems) {
      for (const mid of s.memberIds) {
        if (!bodyIds.has(mid)) {
          ctx.addIssue({
            code: "custom",
            message: `system ${s.id} memberId missing body card: ${mid}`,
            path: ["systems"],
          });
        }
      }
    }
    for (const b of cat.bodies) {
      if (!b.systemId) {
        ctx.addIssue({
          code: "custom",
          message: `body ${b.id} missing required systemId (v2 loud fail)`,
          path: ["bodies"],
        });
      } else if (!systemIds.has(b.systemId)) {
        ctx.addIssue({
          code: "custom",
          message: `body ${b.id} systemId not found: ${b.systemId}`,
          path: ["bodies"],
        });
      }
      if (b.parentId && !bodyIds.has(b.parentId)) {
        ctx.addIssue({
          code: "custom",
          message: `body ${b.id} parentId not found: ${b.parentId}`,
          path: ["bodies"],
        });
      }
    }
    if (bodyIds.size !== cat.bodies.length) {
      ctx.addIssue({
        code: "custom",
        message: "duplicate body ids",
        path: ["bodies"],
      });
    }
    if (systemIds.size !== cat.systems.length) {
      ctx.addIssue({
        code: "custom",
        message: "duplicate system ids",
        path: ["systems"],
      });
    }
  });

function parseArgs(argv) {
  const out = {
    dataDir: null,
    catalog: null, // legacy single-file (rejected for v2)
    centralBody: null,
    centralRadiusAu: null,
    strictWarnings: false,
    system: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--data-dir") out.dataDir = argv[++i];
    else if (a === "--catalog") out.catalog = argv[++i];
    else if (a === "--central-body") out.centralBody = argv[++i];
    else if (a === "--central-radius-au") out.centralRadiusAu = Number(argv[++i]);
    else if (a === "--strict-warnings") out.strictWarnings = true;
    else if (a === "--system") out.system = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function periapsisAu(orbit) {
  if (orbit.qAu != null && Number.isFinite(orbit.qAu)) return orbit.qAu;
  return orbit.aAu * (1 - orbit.e);
}

function resolveDataDir(argPath) {
  if (argPath) return resolve(process.cwd(), argPath);
  const candidates = [
    resolve(process.cwd(), "src/data"),
    resolve(HERE, "../src/data"),
  ];
  return candidates[0];
}

function loadJsonDir(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch (err) {
    throw new Error(`cannot read directory ${dir}: ${err}`);
  }
  for (const f of entries.sort()) {
    const raw = JSON.parse(readFileSync(join(dir, f), "utf8"));
    out.push(raw);
  }
  return out;
}

function findCentralBody(bodies, idHint) {
  if (idHint) {
    const hit = bodies.find((b) => b.id === idHint);
    if (!hit) throw new Error(`central body id not found: ${idHint}`);
    return hit;
  }
  // Prefer body with no parent + star, else first star, else sun id
  return (
    bodies.find((b) => b.kind === "star" && !b.parentId) ??
    bodies.find((b) => b.kind === "star") ??
    bodies.find((b) => b.id === "sun")
  );
}

function collectWeakFieldFlags(body, centralId) {
  const flags = [];
  if (!body.meta.sources?.length) flags.push("meta.sources missing");
  for (const s of body.meta.sources ?? []) {
    const u = String(s.url ?? "");
    if (/horizons\.api/i.test(u) || /format=json/i.test(u) || /\/api\//i.test(u)) {
      flags.push(`meta.sources must be human page, not API: ${u.slice(0, 96)}`);
    }
    if (/nssdc\.gsfc\.nasa\.gov/i.test(u)) {
      flags.push(`meta.sources blocked host (bad cert/HSTS): ${u.slice(0, 96)}`);
    }
  }
  if (!body.meta.fetchedAt) flags.push("meta.fetchedAt missing");
  if (!body.meta.provenance && !body.meta.source) {
    flags.push("meta.provenance|source missing");
  }
  if (!body.meta.confidence) flags.push("meta.confidence missing");
  if (body.id !== centralId && !body.orbit) flags.push("orbit missing (non-central)");
  if (body.orbit && body.id !== centralId) {
    if (!body.horizonId && !body.sbdbDes) flags.push("horizonId/sbdbDes missing");
    if (!body.orbit.frame) flags.push("orbit.frame missing");
  }
  if (body.kind === "star" && !body.horizonId) flags.push("horizonId missing (star)");
  if (body.facts.radiusMeanKm == null) flags.push("facts.radiusMeanKm missing");
  if (body.facts.densityGcm3 == null && body.kind !== "star") {
    flags.push("facts.densityGcm3 missing");
  }
  if (body.facts.albedo == null && body.kind !== "star" && body.kind !== "moon") {
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
  --data-dir <path>          default: src/data (systems/ + bodies/)
  --system <id>              validate one system graph (default: home)
  --central-body <id>        default: star without parent (else sun)
  --central-radius-au <n>    override central radius (au); else from catalog
  --strict-warnings          exit 1 if any weak-field flags`);
  process.exit(0);
}

if (args.catalog) {
  console.error(
    "VALIDATION FAIL: --catalog single-file is retired (v1). Use Store B --data-dir (systems/ + bodies/).",
  );
  process.exit(1);
}

const dataDir = resolveDataDir(args.dataDir);
let systems;
let bodies;
try {
  systems = loadJsonDir(join(dataDir, "systems"));
  bodies = loadJsonDir(join(dataDir, "bodies"));
} catch (err) {
  console.error(`VALIDATION FAIL: cannot load Store B data under ${dataDir}`);
  console.error(String(err));
  process.exit(1);
}

const raw = { version: CATALOG_VERSION, systems, bodies };
const parsed = CatalogSchema.safeParse(raw);
if (!parsed.success) {
  console.error("VALIDATION FAIL (schema v2)");
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

const catalog = parsed.data;
const home = catalog.systems.find((s) => s.home === true);
if (!home && !args.system) {
  console.error("VALIDATION FAIL: no home system and no --system");
  process.exit(1);
}

const bodyById = new Map(catalog.bodies.map((b) => [b.id, b]));
const systemsToCheck = args.system
  ? catalog.systems.filter((s) => s.id === args.system)
  : catalog.systems;

if (args.system && systemsToCheck.length === 0) {
  console.error(`VALIDATION FAIL: system not found: ${args.system}`);
  process.exit(1);
}

console.log("dataDir", dataDir);
console.log("version", catalog.version);
console.log("systems", catalog.systems.length);
console.log("bodies", catalog.bodies.length);

const hardErrors = [];
const warnings = [];

for (const system of systemsToCheck) {
  const graphBodies = system.memberIds
    .map((id) => bodyById.get(id))
    .filter(Boolean);

  const central = findCentralBody(graphBodies, args.centralBody);
  if (!central) {
    hardErrors.push(`${system.id}: no central body (star) found; pass --central-body`);
    continue;
  }

  const centralRadiusKm = central.facts.radiusMeanKm;
  if (centralRadiusKm == null && !(args.centralRadiusAu > 0)) {
    hardErrors.push(`${system.id}: central body missing facts.radiusMeanKm`);
    continue;
  }

  const centralRadiusAu =
    args.centralRadiusAu != null && Number.isFinite(args.centralRadiusAu)
      ? args.centralRadiusAu
      : centralRadiusKm / AU_KM;

  if (!(centralRadiusAu > 0)) {
    hardErrors.push(`${system.id}: central body radius must be positive`);
    continue;
  }

  console.log(
    "graph",
    system.id,
    "members",
    graphBodies.length,
    "home",
    system.home === true,
  );
  console.log(
    `  central ${central.id} radiusMeanKm=${central.facts.radiusMeanKm} radiusAu=${centralRadiusAu}`,
  );

  for (const b of graphBodies) {
    if (b.systemId !== system.id) {
      hardErrors.push(`${b.id}: systemId ${b.systemId} ≠ system ${system.id}`);
    }
    if (b.id === central.id) continue;
    if (!b.orbit) {
      hardErrors.push(`${b.id}: missing orbit while not central body`);
      continue;
    }
    const q = periapsisAu(b.orbit);
    if (b.orbit.frame === "parent") {
      if (!b.parentId) {
        hardErrors.push(`${b.id}: orbit.frame=parent requires parentId`);
      } else {
        const parent = bodyById.get(b.parentId);
        if (!parent) {
          hardErrors.push(`${b.id}: parentId ${b.parentId} not in catalog`);
        } else {
          const parentRkm = parent.facts?.radiusMeanKm;
          if (parentRkm == null || !(parentRkm > 0)) {
            hardErrors.push(
              `${b.id}: parent ${parent.id} missing facts.radiusMeanKm for parent-frame clearance`,
            );
          } else {
            const parentR = parentRkm / AU_KM;
            if (!(q > parentR + EPS_AU)) {
              hardErrors.push(
                `${b.id}: parent-frame periapsis q=${q.toPrecision(8)} au does not clear parent '${parent.id}' radius ${parentR.toPrecision(8)} au`,
              );
            }
          }
        }
      }
    } else if (!(q > centralRadiusAu + EPS_AU)) {
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
}

if (hardErrors.length) {
  console.error("VALIDATION FAIL (orbit clearance / graph)");
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
  "orbit_clearance_ok true (all systems: orbiters qAu|a*(1-e) > central radius)",
);