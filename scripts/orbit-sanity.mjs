#!/usr/bin/env node
/**
 * Orbitpedia viz / Kepler sanity for every Store B system graph.
 *
 * Catalog-side physical clearance lives in validate-catalog.mjs:
 *   q = orbit.qAu ?? aAu*(1-e)  MUST  q > centralRadiusAu (real km→AU).
 *
 * Per system:
 *   1) Heliocentric orbiters: display-scaled q clears starVis + bodyVis + margin
 *      (shared helio display scale — same formula as parent-frame moons)
 *   2) Sampled ellipse |r| stays outside REAL central radius (au) [heliocentric]
 *   3) Solar-mass systems: periodD ≈ GAUSS_YEAR_D * aAu^1.5 within tol
 *      Other hosts: periodD ≈ GAUSS_YEAR_D * aAu^1.5 / sqrt(M/Msun) (skip if mass unknown)
 *   4) Central star has no heliocentric orbit / no OrbitLine required
 *   5) Parent-frame: q clears parent real radius; shared viz scale; skip sun Kepler-3
 *   6) Epoch MA pose lies on true-anomaly OrbitLine polyline (body-on-line)
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
const SAMPLE_N = 192;
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
  let m = M % (Math.PI * 2);
  if (m > Math.PI) m -= Math.PI * 2;
  if (m < -Math.PI) m += Math.PI * 2;
  let E = e < 0.8 ? m : Math.PI;
  for (let i = 0; i < 32; i++) {
    const f = E - e * Math.sin(E) - m;
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

function positionAtTrueAnomaly(el, nuDeg) {
  const nu = nuDeg * DEG;
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

function sampleOrbitTrueAnomaly(el, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    pts.push(positionAtTrueAnomaly(el, (360 * i) / n));
  }
  return pts;
}

/** Distance from point p to segment ab. */
function distPointToSeg(p, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  const apz = p[2] - a[2];
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 > 0 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return hypot3(a[0] + abx * t - p[0], a[1] + aby * t - p[1], a[2] + abz * t - p[2]);
}

/** Min distance from live MA pose to the drawn true-anomaly polyline. */
function distBodyToOrbitLine(el, maDeg, n) {
  const live = positionAtMa(el, maDeg);
  const pts = sampleOrbitTrueAnomaly(el, n);
  let minD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distPointToSeg(live, pts[i], pts[i + 1]);
    if (d < minD) minD = d;
  }
  return minD;
}

/** Match src/viz/sizeTiers.ts parentFrameDisplayScale (viz-only). */
function parentFrameDisplayScale(childOrbitQAu, parentVis, childVis, marginCap) {
  const margin = Math.min(marginCap, Math.max(parentVis * 0.35, childVis));
  const need = Math.max(parentVis + childVis + margin, parentVis * 1.85 + childVis);
  if (!(childOrbitQAu > 0) || !Number.isFinite(childOrbitQAu)) return 1;
  return childOrbitQAu >= need ? 1 : need / childOrbitQAu;
}

/** Match src/viz/sizeTiers.ts parentFrameSharedDisplayScale (viz-only). */
function parentFrameSharedDisplayScale(parentVis, children, marginCap) {
  if (!children.length) return 1;
  let s = 1;
  for (const c of children) {
    s = Math.max(s, parentFrameDisplayScale(c.qAu, parentVis, c.vis, marginCap));
  }
  const sorted = [...children].sort((a, b) => a.aAu - b.aAu);
  for (let i = 0; i < sorted.length - 1; i++) {
    const inner = sorted[i];
    const outer = sorted[i + 1];
    const gap = outer.aAu * (1 - outer.e) - inner.aAu * (1 + inner.e);
    const sepMargin = Math.min(marginCap, Math.max(inner.vis, outer.vis));
    const need = inner.vis + outer.vis + sepMargin;
    if (gap > 1e-12) {
      s = Math.max(s, need / gap);
    } else {
      const da = outer.aAu - inner.aAu;
      if (da > 1e-12) s = Math.max(s, need / da);
    }
  }
  return s;
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

const M_SUN_KG = 1.98841e30;
const tiers = loadVisualTiers();

console.log("orbit-sanity");
console.log(`  data ${DATA}`);
console.log(`  systems ${systems.length} (home=${home.id})`);
console.log(`  EPS_AU=${EPS_AU} PERIOD_REL_TOL=${PERIOD_REL_TOL} GAUSS_YEAR_D=${GAUSS_YEAR_D}`);

/** Max allowed distance from epoch MA pose to OrbitLine polyline (au). */
const BODY_ON_LINE_TOL_AU = 0.02;

function meanPeriodDaysForStar(aAu, starMassKg) {
  if (!(starMassKg > 0) || !Number.isFinite(starMassKg)) {
    return meanPeriodDays(aAu);
  }
  const mSun = starMassKg / M_SUN_KG;
  return meanPeriodDays(aAu) / Math.sqrt(mSun);
}

function runSystemSanity(system) {
  const bodies = system.memberIds.map((id) => {
    const b = bodyById.get(id);
    if (!b) {
      fail(`system ${system.id} member missing body card: ${id}`);
    }
    return b;
  }).filter(Boolean);

  for (const b of bodies) {
    if (!b.systemId) {
      fail(`${b.id}: missing systemId (v2 loud fail)`);
    } else if (b.systemId !== system.id) {
      fail(`${b.id}: systemId ${b.systemId} ≠ system ${system.id}`);
    }
  }

  const central =
    bodies.find((b) => b.kind === "star" && !b.parentId) ??
    bodies.find((b) => b.kind === "star") ??
    bodies.find((b) => b.id === "sun");
  if (!central) {
    fail(`no central star in system ${system.id}`);
    return;
  }

  const realSunRadiusAu = (central.facts?.radiusMeanKm ?? 0) / AU_KM;
  if (!(realSunRadiusAu > 0)) {
    fail(`${central.id}: facts.radiusMeanKm required for sanity`);
    return;
  }
  const sunVisual = visualRadius(central, tiers);
  const starMassKg = central.facts?.massKg;
  const mSun = starMassKg > 0 ? starMassKg / M_SUN_KG : NaN;
  const solarKepler = Number.isFinite(mSun) && Math.abs(mSun - 1) < 0.05;

  console.log(`\n=== system ${system.id} members ${bodies.length}${system.home ? " (home)" : ""} ===`);
  console.log(`  central ${central.id} realRadiusAu=${realSunRadiusAu} visualRadius=${sunVisual} M/Msun=${Number.isFinite(mSun) ? mSun.toPrecision(4) : "?"}`);

  if (central.orbit) {
    fail(`${central.id}: central star must not carry a heliocentric orbit`);
  } else {
    ok(`${central.id}: no heliocentric orbit (no OrbitLine)`);
  }

  const orbiters = bodies.filter((b) => b.id !== central.id);

  // Heliocentric display scale (matches sizeTiers.heliocentricSharedDisplayScale):
  // star clearance for all primary orbiters; sibling gaps for planet+dwarf only
  // (asteroids excluded — crossing Vesta/Ceres once blew Sol ~35×).
  const helioKids = orbiters.filter(
    (b) => hasUsableOrbit(b) && b.orbit?.frame !== "parent",
  );
  const helioRows = helioKids.map((c) => ({
    kind: c.kind,
    qAu: periapsisAu(c.orbit),
    aAu: c.orbit.aAu,
    e: c.orbit.e,
    vis: visualRadius(c, tiers),
  }));
  let helioScale = 1;
  for (const c of helioRows) {
    helioScale = Math.max(
      helioScale,
      parentFrameDisplayScale(
        c.qAu,
        sunVisual,
        c.vis,
        tiers.PERIHELION_CLEARANCE_MARGIN_AU,
      ),
    );
  }
  const spaced = helioRows.filter(
    (c) => c.kind === "planet" || c.kind === "dwarf_planet",
  );
  if (spaced.length) {
    helioScale = Math.max(
      helioScale,
      parentFrameSharedDisplayScale(
        sunVisual,
        spaced,
        tiers.PERIHELION_CLEARANCE_MARGIN_AU,
      ),
    );
  }
  if (helioKids.length) {
    ok(`${system.id}: heliocentric display scale=${helioScale.toPrecision(4)}`);
    if (system.id === "solar" || system.id === "sol" || system.id === "solar-system") {
      if (helioScale > 2) {
        fail(`${system.id}: schematic heliocentric scale ${helioScale} must stay near 1 (asteroids must not drive sibling inflate)`);
      } else {
        ok(`${system.id}: heliocentric scale near 1 (asteroids excluded from sibling inflate)`);
      }
    }
    // Planet/dwarf meshes must not overlap after shared helio scale.
    const sorted = [...spaced].sort((a, b) => a.aAu - b.aAu);
    for (let i = 0; i < sorted.length - 1; i++) {
      const inner = sorted[i];
      const outer = sorted[i + 1];
      const gap = (outer.aAu - inner.aAu) * helioScale;
      const need = inner.vis + outer.vis;
      if (gap + 1e-9 < need) {
        fail(`${system.id}: primary siblings overlap after helio scale (gap=${gap} need=${need})`);
      }
    }
    if (sorted.length > 1) {
      ok(`${system.id}: planet/dwarf primary siblings clear after helio scale`);
    }
  }

  for (const b of orbiters) {
  if (!hasUsableOrbit(b)) {
    fail(`${b.id}: non-central body missing usable orbit (elements + frame)`);
    continue;
  }
  const o = b.orbit;
  const q = periapsisAu(o);
  const bodyVis = visualRadius(b, tiers);
  const parentFrame = o.frame === "parent";

  if (parentFrame) {
    if (!b.parentId) {
      fail(`${b.id}: parent-frame orbit missing parentId`);
      continue;
    }
    const parent = bodyById.get(b.parentId);
    if (!parent) {
      fail(`${b.id}: parentId ${b.parentId} not found`);
      continue;
    }
    const parentRkm = parent.facts?.radiusMeanKm;
    if (!(parentRkm > 0)) {
      fail(`${b.id}: parent ${parent.id} missing facts.radiusMeanKm`);
      continue;
    }
    const parentRealAu = parentRkm / AU_KM;
    if (!(q > parentRealAu + EPS_AU)) {
      fail(
        `${b.id}: parent-frame q=${q} ≯ parent ${parent.id} real radius ${parentRealAu}`,
      );
    } else {
      ok(
        `${b.id}: parent-frame physical q=${q.toPrecision(6)} > ${parent.id} ${parentRealAu.toPrecision(6)}`,
      );
    }

    // Shared per-parent viz scale checked after the orbiter loop (sibling-aware).

    // Relative ellipse samples clear origin (parent) by q — true-anomaly sweep.
    let minR = Infinity;
    for (let i = 0; i <= SAMPLE_N; i++) {
      const [x, y, z] = positionAtTrueAnomaly(o, (360 * i) / SAMPLE_N);
      const r = hypot3(x, y, z);
      if (r < minR) minR = r;
    }
    if (Math.abs(minR - q) > 1e-3) {
      fail(`${b.id}: parent-frame sampled min|r|=${minR} far from q=${q}`);
    } else {
      ok(`${b.id}: parent-frame sampled min|r|=${minR.toPrecision(6)} ≈ q`);
    }

    if (!(o.periodD != null && Number.isFinite(o.periodD) && o.periodD > 0)) {
      fail(`${b.id}: periodD missing (parent-frame; skip heliocentric Kepler-3)`);
    } else {
      ok(`${b.id}: parent-frame periodD=${o.periodD} (no sun Kepler-3)`);
    }
  } else {
    const need = sunVisual + bodyVis + tiers.PERIHELION_CLEARANCE_MARGIN_AU;
    const qVis = q * helioScale;

    if (!(qVis > need + EPS_AU)) {
      fail(
        `${b.id}: schematic clearance q*scale=${qVis} ≯ sunVis(${sunVisual})+bodyVis(${bodyVis})+margin=${need} (scale=${helioScale})`,
      );
    } else {
      ok(`${b.id}: viz clearance q*scale=${qVis.toPrecision(6)} > ${need.toPrecision(6)}`);
    }

    let minR = Infinity;
    for (let i = 0; i <= SAMPLE_N; i++) {
      const [x, y, z] = positionAtTrueAnomaly(o, (360 * i) / SAMPLE_N);
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
      if (!(starMassKg > 0)) {
        ok(`${b.id}: periodD=${o.periodD} (skip Kepler-3; central mass unknown)`);
      } else {
        const pred = meanPeriodDaysForStar(o.aAu, starMassKg);
        const rel = Math.abs(o.periodD - pred) / pred;
        const label = solarKepler
          ? `${GAUSS_YEAR_D}*a^1.5`
          : `${GAUSS_YEAR_D}*a^1.5/sqrt(M)`;
        if (rel > PERIOD_REL_TOL) {
          fail(
            `${b.id}: periodD=${o.periodD} vs ${label}=${pred} rel=${rel} > ${PERIOD_REL_TOL}`,
          );
        } else {
          ok(`${b.id}: periodD vs Kepler-3 (${label}) rel=${rel.toExponential(2)}`);
        }
      }
    } else {
      fail(`${b.id}: periodD missing`);
    }
  }

  // Mesh must sit on the OrbitLine polyline (same elements / MA / scale).
  const off = distBodyToOrbitLine(o, o.maDeg, SAMPLE_N);
  if (!(off <= BODY_ON_LINE_TOL_AU)) {
    fail(
      `${b.id}: epoch pose is ${off} au off OrbitLine polyline (tol ${BODY_ON_LINE_TOL_AU})`,
    );
  } else {
    ok(`${b.id}: body-on-line dist=${off.toExponential(2)} au`);
  }
}

  // Per-parent shared viz display scale: parent clearance + sibling separation.
  const parentFrameKids = new Map();
  for (const b of orbiters) {
    if (!hasUsableOrbit(b) || b.orbit?.frame !== "parent" || !b.parentId) continue;
    if (!parentFrameKids.has(b.parentId)) parentFrameKids.set(b.parentId, []);
    parentFrameKids.get(b.parentId).push(b);
  }
  for (const [parentId, kids] of parentFrameKids) {
    const parent = bodyById.get(parentId);
    if (!parent) {
      fail(`parent-frame group: missing parent ${parentId}`);
      continue;
    }
    const parentVis = visualRadius(parent, tiers);
    const rows = kids.map((c) => ({
      id: c.id,
      qAu: periapsisAu(c.orbit),
      aAu: c.orbit.aAu,
      e: c.orbit.e,
      vis: visualRadius(c, tiers),
    }));
    const scale = parentFrameSharedDisplayScale(
      parentVis,
      rows,
      tiers.PERIHELION_CLEARANCE_MARGIN_AU,
    );
    for (const r of rows) {
      const qVis = r.qAu * scale;
      const need =
        parentVis +
        r.vis +
        Math.min(
          tiers.PERIHELION_CLEARANCE_MARGIN_AU,
          Math.max(parentVis * 0.35, r.vis),
        );
      if (!(qVis > need - 1e-9)) {
        fail(
          `${r.id}: shared viz q*scale=${qVis} ≯ parentVis+childVis+margin=${need} (scale=${scale})`,
        );
      } else {
        ok(
          `${r.id}: shared viz q*scale=${qVis.toPrecision(6)} > ${need.toPrecision(6)} (scale=${scale.toPrecision(4)})`,
        );
      }
    }
    const sorted = [...rows].sort((a, b) => a.aAu - b.aAu);
    for (let i = 0; i < sorted.length - 1; i++) {
      const inner = sorted[i];
      const outer = sorted[i + 1];
      const innerApo = inner.aAu * (1 + inner.e) * scale;
      const outerPeri = outer.aAu * (1 - outer.e) * scale;
      const gap = outerPeri - innerApo;
      const need = inner.vis + outer.vis;
      if (!(gap >= need - 1e-9)) {
        fail(
          `${parentId} siblings ${inner.id}/${outer.id}: display gap ${gap} < mesh sum ${need} (scale=${scale})`,
        );
      } else {
        ok(
          `${parentId} siblings ${inner.id}/${outer.id}: display gap ${gap.toPrecision(4)} ≥ ${need.toPrecision(4)}`,
        );
      }
    }
    if (sorted.length === 1) {
      ok(`${parentId}: single parent-frame child (shared scale=${scale.toPrecision(4)})`);
    }
  }
} // end runSystemSanity

for (const system of systems) {
  runSystemSanity(system);
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

// Prop/True must dial off the *active* system (star + innermost primary-frame
// perihelion) — never hardcode Sol/Mercury ids. Framing floor stays locked.
{
  const sizeSrc = fs.readFileSync(path.join(ROOT, "src/viz/sizeTiers.ts"), "utf8");
  if (/getBody\(["']mercury["']\)/.test(sizeSrc) || /MERCURY_Q_AU/.test(sizeSrc)) {
    fail("sizeTiers Prop/True still hardcodes Mercury/Sol clearance");
  } else if (!/innermostPrimaryOrbitBody/.test(sizeSrc)) {
    fail("sizeTiers missing innermostPrimaryOrbitBody active-system clearance");
  } else if (!/getSystemGraph/.test(sizeSrc)) {
    fail("sizeTiers must resolve Prop/True via getSystemGraph / active bodies");
  } else {
    ok("sizeTiers Prop/True use active-system clearance (no Mercury/Sol hardcode)");
  }
  const sceneSrc = fs.readFileSync(path.join(ROOT, "src/viz/OrbitScene.tsx"), "utf8");
  if (!/FOCUS_FRAMING_RADIUS_MIN/.test(sceneSrc)) {
    fail("OrbitScene missing FOCUS_FRAMING_RADIUS_MIN (Pluto True/Prop focus floor)");
  } else {
    ok("OrbitScene keeps FOCUS_FRAMING_RADIUS_MIN framing floor");
  }
  // Size-mode camera: proportional offset scale only — not a full FollowCamera reset.
  if (!/sizeModeFrameRef/.test(sceneSrc) || !/framingMetricFor/.test(sceneSrc)) {
    fail("OrbitScene missing proportional size-mode camera framing scale");
  } else if (
    /}, \[focusId, camera, controls, invalidate, distScale, sizeMode\]/.test(sceneSrc)
  ) {
    fail("FollowCamera must not re-snap pose when sizeMode is in focus-effect deps");
  } else {
    ok("FollowCamera scales camera by size-mode framing ratio (no full reset)");
  }
  // Idle camera: extent × pad for compact systems; legacy cap preserves Sol.
  if (
    !/systemSceneExtent/.test(sceneSrc) ||
    !/idleCameraDistance/.test(sceneSrc) ||
    !/IDLE_EXTENT_PAD/.test(sceneSrc) ||
    !/IdleCameraBootstrap/.test(sceneSrc)
  ) {
    fail("OrbitScene missing extent-based idle camera framing");
  } else {
    ok("OrbitScene idle camera uses system extent (legacy cap for Sol-scale)");
  }
}

// Procedural body materials + marquee texture registry (fail-open).
{
  const appearanceDir = path.join(ROOT, "src/viz/appearance");
  const need = [
    "surfaceFamily.ts",
    "proceduralTextures.ts",
    "materialPool.ts",
    "textureRegistry.ts",
    "textureLoader.ts",
    "index.ts",
  ];
  for (const f of need) {
    if (!fs.existsSync(path.join(appearanceDir, f))) {
      fail(`missing appearance module ${f}`);
    }
  }
  const poolSrc = fs.readFileSync(path.join(appearanceDir, "materialPool.ts"), "utf8");
  const famSrc = fs.readFileSync(path.join(appearanceDir, "surfaceFamily.ts"), "utf8");
  const procSrc = fs.readFileSync(path.join(appearanceDir, "proceduralTextures.ts"), "utf8");
  const regSrc = fs.readFileSync(path.join(appearanceDir, "textureRegistry.ts"), "utf8");
  const loaderSrc = fs.readFileSync(path.join(appearanceDir, "textureLoader.ts"), "utf8");
  const sceneSrc = fs.readFileSync(path.join(ROOT, "src/viz/OrbitScene.tsx"), "utf8");
  if (!/getBodyAppearanceMaterial/.test(poolSrc)) {
    fail("materialPool missing getBodyAppearanceMaterial");
  }
  if (!/inferSurfaceFamily/.test(famSrc) || !/SurfaceFamily/.test(famSrc)) {
    fail("surfaceFamily missing inferSurfaceFamily / SurfaceFamily");
  }
  if (!/getBodyAppearanceMaterial/.test(sceneSrc)) {
    fail("OrbitScene BodyMesh must use getBodyAppearanceMaterial");
  }
  if (/sharedSunMat/.test(sceneSrc)) {
    fail("OrbitScene still uses sharedSunMat flat star color");
  }
  if (!/useRegistryTexture/.test(sceneSrc)) {
    fail("OrbitScene BodyMesh must useRegistryTexture for marquee maps");
  }
  if (!/TEXTURE_REGISTRY/.test(regSrc) || !/earth-marquee/.test(regSrc)) {
    fail("textureRegistry must seed earth-marquee");
  }
  if (!/requestRegistryTexture/.test(loaderSrc) || !/resolve\(null\)/.test(loaderSrc)) {
    fail("textureLoader missing fail-open requestRegistryTexture");
  } else {
    ok("textureLoader fail-open on miss/error");
  }
  // Gas procedural must show latitudinal bands (sin over v), not flat noise only.
  if (!/case "gas"/.test(procSrc) || !/Math\.sin\(\s*v\s*\*\s*Math\.PI/.test(procSrc)) {
    fail("proceduralTextures gas family must use latitudinal Math.sin(v * Math.PI…) bands");
  } else {
    ok("gas procedural has latitudinal bands");
  }
  if (!/case "ice"/.test(procSrc) || !/Math\.sin\(\s*v\s*\*\s*Math\.PI/.test(procSrc)) {
    fail("proceduralTextures ice family must use latitudinal bands");
  } else {
    ok("ice procedural has latitudinal bands");
  }
  // Guard: pack files exist, sized, and registry keys match seeded cards.
  const texDir = path.join(ROOT, "public/textures");
  const seeded = {
    earth: "earth-marquee",
    moon: "moon-marquee",
    mars: "mars-marquee",
    jupiter: "jupiter-marquee",
    venus: "venus-marquee",
    saturn: "saturn-marquee",
    uranus: "uranus-marquee",
    neptune: "neptune-marquee",
    sun: "sun-marquee",
  };
  let packBytes = 0;
  let mapCount = 0;
  for (const [bodyId, texId] of Object.entries(seeded)) {
    const body = bodyById.get(bodyId);
    if (!body) {
      fail(`marquee body missing: ${bodyId}`);
      continue;
    }
    if (body.appearance?.textureId !== texId) {
      fail(`${bodyId} appearance.textureId want ${texId}, got ${body.appearance?.textureId}`);
    } else {
      ok(`${bodyId} textureId=${texId}`);
    }
    if (!new RegExp(`"${texId}"`).test(regSrc) && !regSrc.includes(texId)) {
      fail(`TEXTURE_REGISTRY missing ${texId}`);
    }
    const webp = path.join(texDir, `${texId}.webp`);
    if (!fs.existsSync(webp)) {
      fail(`missing texture file ${texId}.webp`);
      continue;
    }
    const st = fs.statSync(webp);
    packBytes += st.size;
    mapCount += 1;
    if (st.size > 512 * 1024) {
      fail(`${texId}.webp over 512KB (${st.size})`);
    } else {
      ok(`${texId}.webp ${(st.size / 1024).toFixed(1)}KB`);
    }
  }
  // Honest Guard totals: every WebP in the pack, not just the seeded checklist.
  if (fs.existsSync(texDir)) {
    packBytes = 0;
    mapCount = 0;
    for (const name of fs.readdirSync(texDir)) {
      if (!name.endsWith(".webp")) continue;
      packBytes += fs.statSync(path.join(texDir, name)).size;
      mapCount += 1;
    }
  }
  if (packBytes > 6 * 1024 * 1024) {
    fail(`texture pack over 6MB (${packBytes})`);
  } else {
    ok(`texture pack ${(packBytes / 1024 / 1024).toFixed(2)}MB (${mapCount} maps)`);
  }
  if (mapCount > 12) {
    fail(`too many marquee maps: ${mapCount}`);
  }
  // Facts must not surface texture/appearance fields.
  const factsSrc = fs.readFileSync(path.join(ROOT, "src/lib/factsDisplay.ts"), "utf8");
  if (/textureId|appearance/.test(factsSrc)) {
    fail("factsDisplay must not expose textureId/appearance");
  }
  // Golden family inference (mirrors surfaceFamily.ts thresholds).
  const GAS_RADIUS_KM = 20_000;
  const CLASSIC_GAS_RADIUS_KM = 40_000;
  function inferFamily(body) {
    if (body.kind === "star") return "star";
    const r = body.facts?.radiusMeanKm;
    const density = body.facts?.densityGcm3;
    const albedo = body.facts?.albedo;
    if (body.kind === "planet" && r != null && r > GAS_RADIUS_KM) {
      return r < CLASSIC_GAS_RADIUS_KM ? "ice" : "gas";
    }
    if (albedo != null && albedo >= 0.5) return "ice";
    if (
      density != null &&
      density < 2.0 &&
      (r == null || r < 5_000) &&
      body.kind !== "planet"
    ) {
      return "ice";
    }
    return "rocky";
  }
  const expect = {
    sun: "star",
    jupiter: "gas",
    saturn: "gas",
    uranus: "ice",
    neptune: "ice",
    earth: "rocky",
    mars: "rocky",
    ceres: "rocky",
  };
  for (const [id, want] of Object.entries(expect)) {
    const body = bodyById.get(id);
    if (!body) {
      fail(`appearance golden missing body ${id}`);
      continue;
    }
    const got = inferFamily(body);
    if (got !== want) {
      fail(`appearance family ${id}: got ${got}, want ${want}`);
    } else {
      ok(`appearance family ${id} → ${got}`);
    }
  }
  ok("procedural + marquee maps wired (pool + BodyMesh + registry; fail-open)");
  // Soft selection glow — avoid neon rim regression (emissiveIntensity was 0.45).
  if (!/FOCUS_EMISSIVE_INTENSITY/.test(poolSrc)) {
    fail("materialPool missing FOCUS_EMISSIVE_INTENSITY soft-select constant");
  } else {
    const m = poolSrc.match(/FOCUS_EMISSIVE_INTENSITY\s*=\s*([0-9.]+)/);
    const v = m ? Number(m[1]) : NaN;
    if (!(v > 0 && v <= 0.25)) {
      fail(`selection emissiveIntensity too strong: ${v} (want >0 and ≤0.25)`);
    } else {
      ok(`selection glow soft (FOCUS_EMISSIVE_INTENSITY=${v})`);
    }
  }
  if (!/NoColorSpace/.test(fs.readFileSync(path.join(appearanceDir, "proceduralTextures.ts"), "utf8"))) {
    fail("proceduralTextures should use NoColorSpace for grayscale modulation maps");
  } else {
    ok("procedural maps use NoColorSpace (catalog color fidelity)");
  }
}

if (process.exitCode) {
  console.error("\norbit-sanity FAILED");
  process.exit(process.exitCode);
}
console.log("\norbit-sanity PASSED");
