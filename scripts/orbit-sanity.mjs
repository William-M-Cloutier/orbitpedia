#!/usr/bin/env node
/**
 * Orbitpedia viz / Kepler sanity for the loaded home system graph (Store B).
 *
 * Catalog-side physical clearance lives in validate-catalog.mjs:
 *   q = orbit.qAu ?? aAu*(1-e)  MUST  q > centralRadiusAu (real km→AU).
 *
 * This script owns schematic + Kepler checks on getHomeSystem members:
 *   1) For every orbiter: q > visualRadius(sun) + visualRadius(body) + margin
 *   2) Sampled ellipse |r| stays outside REAL sun radius (au)
 *   3) periodD ≈ GAUSS_YEAR_D * aAu^1.5 within relative tolerance
 *   4) Central star has no heliocentric orbit / no OrbitLine required
 *
 * Usage: node scripts/orbit-sanity.mjs
 *        npm test
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "src/data");

/** Sidereal year (days) for heliocentric Kepler-3 mean period. */
const GAUSS_YEAR_D = 365.256363;
const AU_KM = 1.495_978_707e8;
const EPS_AU = 1e-9;
const PERIOD_REL_TOL = 0.02;
const SAMPLE_N = 96;
const DEG = Math.PI / 180;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}

function ok(msg) {
  console.log(`ok  ${msg}`);
}

function periapsisAu(orbit) {
  if (orbit.qAu != null && Number.isFinite(orbit.qAu)) return orbit.qAu;
  return orbit.aAu * (1 - orbit.e);
}

function solveKepler(M, e, tol = 1e-12) {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 32; i++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const d = f / fp;
    E -= d;
    if (Math.abs(d) < tol) break;
  }
  return E;
}

function trueAnomaly(E, e) {
  return Math.atan2(Math.sqrt(1 - e * e) * Math.sin(E), Math.cos(E) - e);
}

function positionAtMa(el, maDeg) {
  const M = (maDeg ?? el.maDeg) * DEG;
  const E = solveKepler(M, el.e);
  const nu = trueAnomaly(E, el.e);
  const r = (el.aAu * (1 - el.e * el.e)) / (1 + el.e * Math.cos(nu));
  const xOrb = r * Math.cos(nu);
  const yOrb = r * Math.sin(nu);
  const i = el.iDeg * DEG;
  const om = el.omDeg * DEG;
  const w = el.wDeg * DEG;
  const cosOm = Math.cos(om);
  const sinOm = Math.sin(om);
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);
  const x =
    (cosOm * cosW - sinOm * sinW * cosI) * xOrb +
    (-cosOm * sinW - sinOm * cosW * cosI) * yOrb;
  const y =
    (sinOm * cosW + cosOm * sinW * cosI) * xOrb +
    (-sinOm * sinW + cosOm * cosW * cosI) * yOrb;
  const z = sinW * sinI * xOrb + cosW * sinI * yOrb;
  return [x, y, z];
}

function hypot3(x, y, z) {
  return Math.hypot(x, y, z);
}

function loadJsonDir(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

function hasUsableOrbit(body) {
  const o = body.orbit;
  if (!o || body.kind === "star") return false;
  return (
    Number.isFinite(o.aAu) &&
    o.aAu > 0 &&
    Number.isFinite(o.e) &&
    Number.isFinite(o.iDeg) &&
    Number.isFinite(o.omDeg) &&
    Number.isFinite(o.wDeg) &&
    Number.isFinite(o.maDeg) &&
    o.frame != null
  );
}

function loadVisualTiers() {
  const src = fs.readFileSync(path.join(ROOT, "src/viz/sizeTiers.ts"), "utf8");
  const num = (name) => {
    const m = src.match(new RegExp(`export const ${name} = ([0-9.]+)`));
    if (!m) throw new Error(`sizeTiers missing export const ${name}`);
    return Number(m[1]);
  };
  return {
    STAR_VISUAL_RADIUS: num("STAR_VISUAL_RADIUS"),
    PLANET_VISUAL_RADIUS_SMALL: num("PLANET_VISUAL_RADIUS_SMALL"),
    PLANET_VISUAL_RADIUS_LARGE: num("PLANET_VISUAL_RADIUS_LARGE"),
    PERIHELION_CLEARANCE_MARGIN_AU: num("PERIHELION_CLEARANCE_MARGIN_AU"),
    dwarf: 0.07,
    asteroid: 0.05,
    moon: 0.04,
  };
}

function visualRadius(body, tiers) {
  switch (body.kind) {
    case "star":
      return tiers.STAR_VISUAL_RADIUS;
    case "planet":
      return (body.facts?.radiusMeanKm ?? 0) > 20000
        ? tiers.PLANET_VISUAL_RADIUS_LARGE
        : tiers.PLANET_VISUAL_RADIUS_SMALL;
    case "dwarf_planet":
      return tiers.dwarf;
    case "asteroid":
      return tiers.asteroid;
    case "moon":
      return tiers.moon;
    default:
      throw new Error(`unknown kind ${body.kind}`);
  }
}

function meanPeriodDays(aAu) {
  return GAUSS_YEAR_D * Math.pow(aAu, 1.5);
}

const systems = loadJsonDir(path.join(DATA, "systems"));
const allBodies = loadJsonDir(path.join(DATA, "bodies"));
const bodyById = new Map(allBodies.map((b) => [b.id, b]));
const home = systems.find((s) => s.home === true);
if (!home) {
  fail("no home system (home: true) under src/data/systems/");
  process.exit(1);
}

const bodies = home.memberIds.map((id) => {
  const b = bodyById.get(id);
  if (!b) {
    fail(`home system member missing body card: ${id}`);
  }
  return b;
}).filter(Boolean);

for (const b of bodies) {
  if (!b.systemId) {
    fail(`${b.id}: missing systemId (v2 loud fail)`);
  } else if (b.systemId !== home.id) {
    fail(`${b.id}: systemId ${b.systemId} ≠ home ${home.id}`);
  }
}

const tiers = loadVisualTiers();
const central =
  bodies.find((b) => b.kind === "star" && !b.parentId) ??
  bodies.find((b) => b.kind === "star") ??
  bodies.find((b) => b.id === "sun");
if (!central) {
  fail("no central star/sun in home system graph");
  process.exit(1);
}

const realSunRadiusAu = (central.facts?.radiusMeanKm ?? 0) / AU_KM;
if (!(realSunRadiusAu > 0)) {
  fail(`${central.id}: facts.radiusMeanKm required for sanity`);
  process.exit(1);
}
const sunVisual = visualRadius(central, tiers);

console.log("orbit-sanity");
console.log(`  data ${DATA}`);
console.log(`  homeSystem ${home.id} members ${bodies.length}`);
console.log(`  central ${central.id} realRadiusAu=${realSunRadiusAu} visualRadius=${sunVisual}`);
console.log(`  EPS_AU=${EPS_AU} PERIOD_REL_TOL=${PERIOD_REL_TOL} GAUSS_YEAR_D=${GAUSS_YEAR_D}`);
console.log(
  `  visual clearance: q > sunVisual(${sunVisual}) + bodyVisual + margin(${tiers.PERIHELION_CLEARANCE_MARGIN_AU})`,
);

if (central.orbit) {
  fail(`${central.id}: central star must not carry a heliocentric orbit`);
} else {
  ok(`${central.id}: no heliocentric orbit (no OrbitLine)`);
}

const orbiters = bodies.filter((b) => b.id !== central.id);

for (const b of orbiters) {
  if (!hasUsableOrbit(b)) {
    fail(`${b.id}: non-central body missing usable orbit (elements + frame)`);
    continue;
  }
  const o = b.orbit;
  const q = periapsisAu(o);
  const bodyVis = visualRadius(b, tiers);
  const need = sunVisual + bodyVis + tiers.PERIHELION_CLEARANCE_MARGIN_AU;

  if (!(q > need + EPS_AU)) {
    fail(
      `${b.id}: schematic clearance q=${q} ≯ sunVis(${sunVisual})+bodyVis(${bodyVis})+margin(${tiers.PERIHELION_CLEARANCE_MARGIN_AU})=${need}`,
    );
  } else {
    ok(`${b.id}: viz clearance q=${q.toPrecision(6)} > ${need.toPrecision(6)}`);
  }

  let minR = Infinity;
  for (let i = 0; i <= SAMPLE_N; i++) {
    const ma = (360 * i) / SAMPLE_N;
    const [x, y, z] = positionAtMa(o, ma);
    const r = hypot3(x, y, z);
    if (r < minR) minR = r;
  }
  if (!(minR > realSunRadiusAu + EPS_AU)) {
    fail(
      `${b.id}: sampled min |r|=${minR} does not clear real sun radius ${realSunRadiusAu}`,
    );
  } else {
    ok(`${b.id}: sampled min|r|=${minR.toPrecision(6)} > realSun ${realSunRadiusAu.toPrecision(6)}`);
  }

  if (Math.abs(minR - q) > 1e-3) {
    fail(`${b.id}: sampled min|r|=${minR} far from q=${q}`);
  }

  if (o.periodD != null && Number.isFinite(o.periodD)) {
    const pred = meanPeriodDays(o.aAu);
    const rel = Math.abs(o.periodD - pred) / pred;
    if (rel > PERIOD_REL_TOL) {
      fail(
        `${b.id}: periodD=${o.periodD} vs ${GAUSS_YEAR_D}*a^1.5=${pred} rel=${rel} > ${PERIOD_REL_TOL}`,
      );
    } else {
      ok(`${b.id}: periodD vs Kepler-3 rel=${rel.toExponential(2)}`);
    }
  } else {
    fail(`${b.id}: periodD missing`);
  }
}

const keplerSrc = fs.readFileSync(path.join(ROOT, "src/lib/kepler.ts"), "utf8");
const named = keplerSrc.match(/export const GAUSS_YEAR_D = ([0-9.]+)/);
const inline = keplerSrc.match(/Math\.pow\(aAu,\s*1\.5\)\s*\*\s*([0-9.]+)/);
const c = named ? Number(named[1]) : inline ? Number(inline[1]) : NaN;
if (!Number.isFinite(c)) {
  fail("could not parse GAUSS_YEAR_D / periodFromA in kepler.ts");
} else if (Math.abs(c - GAUSS_YEAR_D) > 1e-6) {
  fail(`kepler.ts period factor ${c} != test GAUSS_YEAR_D ${GAUSS_YEAR_D}`);
} else {
  ok(`kepler.ts GAUSS_YEAR_D matches ${GAUSS_YEAR_D}`);
}

if (process.exitCode) {
  console.error("\norbit-sanity FAILED");
  process.exit(process.exitCode);
}
console.log("\norbit-sanity PASSED");
