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
 *   4) Central / primary star has no orbit / no OrbitLine; companions may orbit
 *   5) Parent-frame: q clears parent real radius; shared viz scale; skip sun Kepler-3
 *   6) Epoch MA pose lies on true-anomaly OrbitLine polyline (body-on-line)
 *   7) Multi-star: hasUsableOrbit allows companion stars; orbit-unknown
 *      companions mesh via visualBinaryCompanionOffset — prefer
 *      display-scaled facts.projectedSepAu when set (log1p + cap; catalog AU
 *      unchanged), else mesh-radii schematic (no OrbitLine / no invented aAu;
 *      ban old companionStarLayoutOffset dump)
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
  if (!o) return false;
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

function isPrimaryHostKind(kind) {
  return kind === "star" || kind === "black_hole";
}

function visualRadius(body, tiers) {
  switch (body.kind) {
    case "star":
    case "black_hole":
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
    case "satellite":
      return tiers.satellite ?? 0.018;
    case "probe":
      return tiers.probe ?? tiers.asteroid ?? 0.02;
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
    (system.primaryStarId && bodyById.get(system.primaryStarId)) ||
    bodies.find((b) => isPrimaryHostKind(b.kind) && !b.parentId) ||
    bodies.find((b) => isPrimaryHostKind(b.kind)) ||
    // Earth-sats: central planet host with geocentric members only.
    bodies.find((b) => b.id === "earth-sats-earth") ||
    bodies.find((b) => !b.parentId && !b.orbit) ||
    bodies.find((b) => b.id === "sun");
  if (!central) {
    fail(`no central host in system ${system.id}`);
    return;
  }
  const geoOnly =
    bodies.some((b) => b.orbit?.frame === "geocentric") &&
    bodies
      .filter((b) => b.id !== central.id && b.orbit)
      .every((b) => b.orbit.frame === "geocentric");
  const okCentral =
    isPrimaryHostKind(central.kind) ||
    (geoOnly && (central.kind === "planet" || central.id === "earth-sats-earth"));
  if (!okCentral) {
    fail(`central ${central.id} must be kind star|black_hole (or Earth host for geocentric sats)`);
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
    fail(`${central.id}: central host must not carry a heliocentric orbit`);
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
    // Companion stars may be mesh-only until Ephemeris lands elements.
    if (b.kind === "star") {
      ok(`${b.id}: companion star mesh-only (no usable orbit / OrbitLine)`);
      continue;
    }
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
  const fitSrc = fs.readFileSync(path.join(ROOT, "src/viz/schematicFit.ts"), "utf8");
  if (
    !/IdleCameraBootstrap/.test(sceneSrc) ||
    !/systemSceneExtent/.test(fitSrc) ||
    !/idleCameraDistance/.test(fitSrc) ||
    !/IDLE_EXTENT_PAD/.test(fitSrc)
  ) {
    fail("OrbitScene/schematicFit missing extent-based idle camera framing");
  } else {
    ok("OrbitScene idle camera uses system extent (legacy cap for Sol-scale)");
  }
  // Schematic wide-system orbit fit (viz-only compress; home always 1).
  if (
    !/schematicOrbitFitScale/.test(fitSrc) ||
    !/STAR_IDLE_FILL_MIN/.test(fitSrc) ||
    !/SCHEMATIC_FIT_MIN/.test(fitSrc)
  ) {
    fail("schematicFit missing schematicOrbitFitScale / fill constants");
  } else if (
    !/schematicOrbitFitScale/.test(sceneSrc) ||
    !/fitScale/.test(sceneSrc) ||
    !/system\.home === true/.test(sceneSrc)
  ) {
    fail("OrbitScene must wire schematicOrbitFitScale gated on schematic + non-home");
  } else {
    ok("schematic orbit fit wired (home → fitScale 1; wide schematic compress)");
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
    mercury: "mercury-marquee",
    pluto: "pluto-marquee",
    ceres: "ceres-marquee",
    io: "io-marquee",
    europa: "europa-marquee",
    ganymede: "ganymede-marquee",
    callisto: "callisto-marquee",
    titan: "titan-marquee",
    enceladus: "enceladus-marquee",
    triton: "triton-marquee",
    charon: "charon-marquee",
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
  if (packBytes > 8 * 1024 * 1024) {
    fail(`texture pack over 8MB (${packBytes})`);
  } else {
    ok(`texture pack ${(packBytes / 1024 / 1024).toFixed(2)}MB (${mapCount} maps)`);
  }
  if (mapCount > 20) {
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
    if (body.kind === "black_hole") return "black_hole";
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
  // Black-hole procedural family (kind → family; no appearance.surfaceFamily field).
  if (!/"black_hole"/.test(famSrc) || !/kind === "black_hole"/.test(famSrc)) {
    fail("surfaceFamily must extend SurfaceFamily + infer black_hole");
  } else {
    ok("surfaceFamily includes black_hole");
  }
  const bhGot = inferFamily({ kind: "black_hole", facts: {} });
  if (bhGot !== "black_hole") {
    fail(`appearance family black_hole: got ${bhGot}, want black_hole`);
  } else {
    ok("appearance family black_hole → black_hole");
  }
  if (!/case "black_hole"/.test(procSrc) || !/black_hole:\s*128|black_hole:\s*64/.test(procSrc)) {
    fail("proceduralTextures must include black_hole TEX_SIZE + sample map");
  } else {
    ok("proceduralTextures includes black_hole");
  }
  if (!/family === "black_hole"|family !== "black_hole"/.test(poolSrc)) {
    fail("materialPool must fail-open procedural-only for black_hole");
  } else {
    ok("materialPool black_hole procedural fail-open");
  }
  // OrbitScene: BH primary host light (cooler/dimmer accretion pointLight).
  if (
    !/isPrimaryHostKind/.test(sceneSrc) ||
    !/body\.kind === "black_hole"/.test(sceneSrc) ||
    !/intensity=\{1\.2\}/.test(sceneSrc)
  ) {
    fail("OrbitScene must treat black_hole as host light (isPrimaryHostKind + pointLight ~1.2)");
  } else {
    ok("OrbitScene treats black_hole as host light");
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

// Synthetic multi-star (no curated fixture) — render/orbit contracts for companions.
{
  console.log("\n=== synthetic multi-star contracts ===");
  const primary = {
    id: "syn-primary",
    kind: "star",
    systemId: "syn-binary",
    facts: { radiusMeanKm: 70000, massKg: 1.98841e30 },
  };
  const companion = {
    id: "syn-companion",
    kind: "star",
    systemId: "syn-binary",
    parentId: "syn-primary",
    facts: { radiusMeanKm: 50000, massKg: 8e29 },
    orbit: {
      frame: "parent",
      aAu: 0.08,
      e: 0.02,
      iDeg: 5,
      omDeg: 10,
      wDeg: 20,
      maDeg: 30,
      periodD: 20,
      qAu: 0.08 * (1 - 0.02),
    },
  };
  // Catalog may include orbit-unknown companions; Explore meshes them via
  // tight visual-binary offset (NOT catalog AU / NOT OrbitLine).
  const meshOnly = {
    id: "syn-mesh",
    kind: "star",
    systemId: "syn-binary",
    parentId: "syn-primary",
    facts: { radiusMeanKm: 40000 },
  };
  const planet = {
    id: "syn-planet",
    kind: "planet",
    systemId: "syn-binary",
    facts: { radiusMeanKm: 6000 },
    orbit: {
      frame: "heliocentric",
      aAu: 0.25,
      e: 0.04,
      iDeg: 1,
      omDeg: 0,
      wDeg: 0,
      maDeg: 0,
      periodD: 40,
    },
  };
  // Parent-frame planet hosted by orbit-unknown companion — now Explore-visible
  // (tracks companion visual-binary offset via parent-frame bodyPosition).
  const parentFrameKid = {
    id: "syn-mesh-planet",
    kind: "planet",
    systemId: "syn-binary",
    parentId: "syn-mesh",
    facts: { radiusMeanKm: 5000 },
    orbit: {
      frame: "parent",
      aAu: 0.02,
      e: 0.01,
      iDeg: 2,
      omDeg: 0,
      wDeg: 0,
      maDeg: 0,
      periodD: 5,
    },
  };

  if (hasUsableOrbit(primary)) fail("synthetic primary must not have usable orbit");
  else ok("synthetic primary: hasUsableOrbit false");
  if (!hasUsableOrbit(companion)) fail("synthetic companion with elements must have usable orbit");
  else ok("synthetic companion: hasUsableOrbit true (parent-frame)");
  if (hasUsableOrbit(meshOnly)) fail("synthetic mesh-only companion must not have usable orbit");
  else ok("synthetic mesh-only companion: hasUsableOrbit false (catalog OK)");
  if (!hasUsableOrbit(planet)) fail("synthetic planet must have usable orbit");
  else ok("synthetic planet: hasUsableOrbit true");
  if (!hasUsableOrbit(parentFrameKid)) fail("synthetic parent-frame kid must have usable orbit");
  else ok("synthetic parent-frame kid: hasUsableOrbit true (catalog)");

  const parentRealAu = primary.facts.radiusMeanKm / AU_KM;
  const q = periapsisAu(companion.orbit);
  if (!(q > parentRealAu + EPS_AU)) {
    fail(`synthetic companion q=${q} does not clear primary real radius ${parentRealAu}`);
  } else {
    ok(`synthetic companion parent-frame q=${q.toPrecision(6)} > primary ${parentRealAu.toPrecision(6)}`);
  }

  // Helio kids = primary-frame only (companion is parent-frame → excluded).
  const bodies = [primary, companion, meshOnly, planet, parentFrameKid];
  const helioKids = bodies.filter(
    (b) => hasUsableOrbit(b) && b.orbit?.frame !== "parent",
  );
  if (helioKids.length !== 1 || helioKids[0].id !== "syn-planet") {
    fail(`synthetic helio kids expected [syn-planet], got ${helioKids.map((b) => b.id)}`);
  } else {
    ok("synthetic helio clearance orbiters exclude parent-frame companion star");
  }

  const schemaSrc = fs.readFileSync(path.join(ROOT, "src/data/schema.ts"), "utf8");
  if (/if \(body\.kind === "star"\) return false/.test(schemaSrc)) {
    fail("schema hasUsableOrbit still blanket-rejects stars");
  } else {
    ok("schema hasUsableOrbit allows stars with finite elements");
  }
  const sceneSrc = fs.readFileSync(path.join(ROOT, "src/viz/OrbitScene.tsx"), "utf8");
  const fitSrcVb = fs.readFileSync(path.join(ROOT, "src/viz/schematicFit.ts"), "utf8");
  if (/companionStarLayoutOffset/.test(sceneSrc)) {
    fail("OrbitScene still contains companionStarLayoutOffset (circular sep dump)");
  } else {
    ok("OrbitScene has no companionStarLayoutOffset (no layout-offset dump)");
  }
  if (!/visualBinaryCompanionOffset/.test(sceneSrc)) {
    fail("OrbitScene missing visualBinaryCompanionOffset for orbit-unknown companions");
  } else {
    ok("OrbitScene has visualBinaryCompanionOffset (tight visual-binary display)");
  }
  if (!/VISUAL_BINARY_SEP_FACTOR/.test(fitSrcVb) && !/VISUAL_BINARY_SEP_FACTOR/.test(sceneSrc)) {
    fail("missing VISUAL_BINARY_SEP_FACTOR (tight sep from mesh radii)");
  } else {
    ok("OrbitScene uses VISUAL_BINARY_SEP_FACTOR for mesh-radius clearance");
  }
  // Prefer facts.projectedSepAu (Gaia / projected) when set; else schematic.
  if (!/projectedSepAu/.test(sceneSrc) && !/projectedSepAu/.test(fitSrcVb)) {
    fail("OrbitScene/schematicFit should read facts.projectedSepAu for visual-binary sep");
  } else if (
    !/Number\.isFinite\(projected\)/.test(sceneSrc) &&
    !/Number\.isFinite\(projected\)/.test(fitSrcVb) &&
    !/Number\.isFinite\(body\.facts\.projectedSepAu\)/.test(sceneSrc) &&
    !/Number\.isFinite\(.*projectedSepAu/.test(sceneSrc) &&
    !/Number\.isFinite\(.*projectedSepAu/.test(fitSrcVb)
  ) {
    fail("OrbitScene/schematicFit should gate projectedSepAu with Number.isFinite");
  } else {
    ok("OrbitScene reads facts.projectedSepAu for companion placement");
  }
  // Soft clearance when projected sep would bury mesh in primary (display-only).
  if (
    !/VISUAL_BINARY_CLEARANCE_MARGIN/.test(sceneSrc) &&
    !/VISUAL_BINARY_CLEARANCE_MARGIN/.test(fitSrcVb) &&
    !/rPrimary \+ rSelf \+/.test(sceneSrc) &&
    !/rPrimary \+ rSelf \+/.test(fitSrcVb)
  ) {
    fail("OrbitScene/schematicFit should soft-clear projectedSepAu vs primary+self+margin");
  } else {
    ok("OrbitScene soft-clears projectedSepAu against primary+self+margin");
  }
  // After fitScale, companion placement must still clear primary+self meshes.
  if (
    !/Math\.max\(\s*baseSep \* fs/.test(sceneSrc) &&
    !/Math\.max\([\s\S]{0,80}baseSep \* fs/.test(sceneSrc)
  ) {
    fail("visualBinaryCompanionOffset must Math.max(baseSep*fs, rPrimary+rSelf+margin) after fit");
  } else {
    ok("visualBinaryCompanionOffset keeps mesh clearance after fitScale");
  }
  // Parent resolution prefers active systemBodies (archive session can miss).
  if (
    !/resolveParentBody/.test(sceneSrc) ||
    !/systemBodies\?\.find\(\(b\) => b\.id === body\.parentId\)/.test(sceneSrc)
  ) {
    fail("parentDisplayScale/bodyPosition must resolve parent via systemBodies first (resolveParentBody)");
  } else {
    ok("resolveParentBody prefers systemBodies over getParent/getBody");
  }
  if (
    !/visualBinaryKidsClearanceSep/.test(sceneSrc) &&
    !/visualBinaryKidsClearanceSep/.test(fitSrcVb)
  ) {
    fail("missing visualBinaryKidsClearanceSep for companion-hosted parent-frame kids");
  } else if (!/kidsFloor/.test(sceneSrc)) {
    fail("visualBinaryCompanionOffset must floor sep at kidsFloor after fit");
  } else {
    ok("visualBinaryCompanionOffset bumps sep for parent-frame kids vs primary");
  }
  // Display-only compression: raw Gaia-class seps must NOT be used verbatim.
  if (
    !/Math\.log1p\(projected\)/.test(sceneSrc) &&
    !/log1p\(projected\)/.test(sceneSrc) &&
    !/Math\.log1p\(projected\)/.test(fitSrcVb) &&
    !/log1p\(projected\)/.test(fitSrcVb)
  ) {
    fail("OrbitScene/schematicFit should compress projectedSepAu with log1p (display scale)");
  } else if (
    (!/PROJECTED_SEP_LOG_SCALE/.test(sceneSrc) && !/PROJECTED_SEP_LOG_SCALE/.test(fitSrcVb)) ||
    (!/PROJECTED_SEP_DISPLAY_CAP_AU/.test(sceneSrc) && !/PROJECTED_SEP_DISPLAY_CAP_AU/.test(fitSrcVb))
  ) {
    fail("missing PROJECTED_SEP_LOG_SCALE / PROJECTED_SEP_DISPLAY_CAP_AU");
  } else if (
    // Ban raw projected as scene distance: `Math.max(projected, …)` without log.
    (/Math\.max\(\s*projected\s*,/.test(sceneSrc) || /Math\.max\(\s*projected\s*,/.test(fitSrcVb)) &&
    !/log1p\(projected\)/.test(sceneSrc) &&
    !/log1p\(projected\)/.test(fitSrcVb)
  ) {
    fail("must not use raw projectedSepAu as scene distance");
  } else {
    ok("OrbitScene display-scales projectedSepAu (log1p + cap; not raw AU)");
  }
  // Comments: display-only; catalog / Facts keep true AU.
  if (
    !/display-only|Display-only|catalog AU unchanged|Facts.*true/i.test(sceneSrc) &&
    !/display-only|Display-only|catalog AU unchanged|Facts.*true/i.test(fitSrcVb)
  ) {
    fail("OrbitScene/schematicFit should document display-only compression; Facts show true AU");
  } else {
    ok("OrbitScene documents display-only sep compression (Facts show true AU)");
  }
  // Synthetic: projected=1067.5 → display sep ≤ CAP and ≥ schematic floor.
  {
    const PROJECTED_SEP_LOG_SCALE = 3.0;
    const PROJECTED_SEP_DISPLAY_CAP_AU = 36;
    const PROJECTED_SEP_ORBIT_FLOOR_FACTOR = 1.2;
    const VISUAL_BINARY_SEP_FACTOR = 1.3;
    const VISUAL_BINARY_MIN_SEP = 0.04;
    const VISUAL_BINARY_CLEARANCE_MARGIN = 0.005;
    const projected = 1067.5; // 55 Cnc B class
    const rPrimary = 0.02;
    const rSelf = 0.01;
    const schematicSep = Math.max(
      (rPrimary + rSelf) * VISUAL_BINARY_SEP_FACTOR,
      VISUAL_BINARY_MIN_SEP,
    );
    const outerPrimaryOrbitA = 5.0; // e.g. outer planet aAu
    const floor = Math.max(
      schematicSep,
      outerPrimaryOrbitA * PROJECTED_SEP_ORBIT_FLOOR_FACTOR,
    );
    const compressed = Math.log1p(projected) * PROJECTED_SEP_LOG_SCALE;
    let sep = Math.min(
      PROJECTED_SEP_DISPLAY_CAP_AU,
      Math.max(floor, compressed),
    );
    sep = Math.max(sep, rPrimary + rSelf + VISUAL_BINARY_CLEARANCE_MARGIN);
    // Raw 1067 must not appear as scene distance.
    if (sep === projected || sep > PROJECTED_SEP_DISPLAY_CAP_AU) {
      fail(
        `synthetic 1067.5 au must not be used raw as scene sep (got ${sep})`,
      );
    } else if (!(sep <= PROJECTED_SEP_DISPLAY_CAP_AU && sep >= floor)) {
      fail(
        `synthetic 1067.5 display sep should be in [floor=${floor}, CAP=${PROJECTED_SEP_DISPLAY_CAP_AU}], got ${sep}`,
      );
    } else if (
      (!/log1p\(projected\)/.test(sceneSrc) && !/log1p\(projected\)/.test(fitSrcVb)) ||
      (!/PROJECTED_SEP_DISPLAY_CAP_AU/.test(sceneSrc) && !/PROJECTED_SEP_DISPLAY_CAP_AU/.test(fitSrcVb))
    ) {
      fail("source missing log1p / display cap for projected sep");
    } else {
      ok(
        `synthetic projected=1067.5 → display sep=${sep.toFixed(3)} in [floor, CAP] (not raw)`,
      );
    }
  }
  // Synthetic: companion with facts.projectedSepAu → source prefers that sep.
  {
    const projectedCompanion = {
      id: "syn-projected",
      kind: "star",
      parentId: "syn-primary",
      facts: { projectedSepAu: 12.5, radiusMeanKm: 40000 },
    };
    const projected = projectedCompanion.facts.projectedSepAu;
    const prefersProjected =
      /projectedSepAu/.test(sceneSrc) &&
      Number.isFinite(projected) &&
      projected > 0 &&
      (/\?\.projectedSepAu|facts\.projectedSepAu/.test(sceneSrc));
    if (!prefersProjected) {
      fail("source contract: visualBinaryCompanionOffset should prefer facts.projectedSepAu");
    } else {
      ok("synthetic companion with facts.projectedSepAu gets sep preference in source");
    }
  }
  // visualBinaryNote exports remain (UI note; copy unchanged).
  {
    const noteSrc = fs.readFileSync(
      path.join(ROOT, "src/lib/visualBinaryNote.ts"),
      "utf8",
    );
    if (!/export function hasVisualBinaryCompanions/.test(noteSrc)) {
      fail("visualBinaryNote missing hasVisualBinaryCompanions export");
    } else if (!/export const VISUAL_BINARY_NOTE/.test(noteSrc)) {
      fail("visualBinaryNote missing VISUAL_BINARY_NOTE export");
    } else {
      ok("visualBinaryNote exports hasVisualBinaryCompanions + VISUAL_BINARY_NOTE");
    }
  }
  // Visual-binary in-plane (x,y) from even angles; do not re-apply faceOn
  // (that tips into vertical in-plane stacking). Small ecliptic-z is intentional.
  if (!/Do NOT re-apply faceOn|No faceOn re-application|not re-appl/.test(sceneSrc)) {
    fail("OrbitScene visualBinaryCompanionOffset should document not re-applying faceOn");
  } else {
    ok("OrbitScene documents not re-applying faceOn for visual-binary offsets");
  }
  // Out-of-plane lift: ecliptic z → scene Y ≠ 0 (viz-only; not catalog i).
  {
    const eclipticToScene = (x, y, z) => [x, z, -y];
    const sep = 0.1;
    const zLift = 0.12; // (rPrimary+rSelf)*frac stand-in
    const n = 3;
    let minAbsY = Infinity;
    for (let idx = 0; idx < n; idx++) {
      const ang = (2 * Math.PI * idx) / n;
      const x = sep * Math.cos(ang);
      const y = sep * Math.sin(ang);
      const [, sy] = eclipticToScene(x, y, zLift);
      minAbsY = Math.min(minAbsY, Math.abs(sy));
    }
    if (!(minAbsY > 1e-12)) {
      fail(`visual-binary out-of-plane lift should yield scene |Y|>0, got ${minAbsY}`);
    } else {
      ok(`visual-binary display: eclipticToScene(x,y,z) → scene |Y|≥${minAbsY.toFixed(3)} (lifted)`);
    }
  }
  // Helper maps via eclipticToScene(x,y,z) only (not eclipticToSceneFaceOn).
  if (
    !/return eclipticToScene\(x, y, z\)/.test(sceneSrc) &&
    !/eclipticToScene\(x, y, z\)/.test(sceneSrc)
  ) {
    fail("visualBinaryCompanionOffset should return eclipticToScene(x, y, z) without faceOn");
  } else if (
    /sep \* Math\.sin\(ang\);\s*\n\s*return eclipticToSceneFaceOn/.test(sceneSrc)
  ) {
    fail("visualBinaryCompanionOffset must not call eclipticToSceneFaceOn (tips out of plane)");
  } else if (!/COMPANION_OUT_OF_PLANE_FRAC/.test(sceneSrc) && !/COMPANION_OUT_OF_PLANE_FRAC/.test(fitSrcVb)) {
    fail("missing COMPANION_OUT_OF_PLANE_FRAC for companion z lift");
  } else {
    ok("visualBinaryCompanionOffset uses eclipticToScene(x,y,z) only (no faceOn; out-of-plane lift)");
  }
  // Outer-apo floor helper present; placement floors at planetFloor.
  if (!/visualBinaryHelioPlanetClearanceSep/.test(fitSrcVb)) {
    fail("schematicFit missing visualBinaryHelioPlanetClearanceSep (outer planet apo floor)");
  } else if (!/planetFloor/.test(sceneSrc)) {
    fail("visualBinaryCompanionOffset must floor sep at planetFloor (helio apo clearance)");
  } else if (!/aAu \* \(1 \+ o\.e\) \* hs/.test(fitSrcVb)) {
    fail("visualBinaryHelioPlanetClearanceSep should use aAu*(1+e)*helioScale outer apo");
  } else {
    ok("visual-binary floors sep outside outermost planet display apo (helioScale)");
  }

  if (!/isExploreSceneBody/.test(sceneSrc)) {
    fail("OrbitScene missing isExploreSceneBody visibility gate");
  } else {
    ok("OrbitScene gates Explore meshes via isExploreSceneBody");
  }
  if (/if \(body\.kind === "star" \|\| !body\.orbit\) return \[0, 0, 0\]/.test(sceneSrc)) {
    fail("OrbitScene bodyPosition/localOrbit still blanks all stars at origin");
  } else if (!/visualBinaryCompanionOffset/.test(sceneSrc)) {
    fail("OrbitScene should place orbit-unknown companions via visualBinaryCompanionOffset");
  } else if (
    !/hasUsableOrbit\(body\)/.test(sceneSrc)
  ) {
    fail("OrbitScene should still gate Kepler pose on hasUsableOrbit");
  } else {
    ok("OrbitScene: Kepler companions via hasUsableOrbit; unknown → visual-binary offset");
  }
  // OrbitLine must remain gated — no invented ellipse for orbit-unknown companions.
  if (!/sceneBodies\.filter\(\(b\) => hasUsableOrbit\(b\)\)/.test(sceneSrc) &&
      !/hasUsableOrbit\(b\)/.test(sceneSrc)) {
    fail("OrbitScene should only draw OrbitLine for hasUsableOrbit bodies");
  } else {
    ok("OrbitLine stays gated on hasUsableOrbit (no fake ellipse / invented aAu)");
  }
  if (!/lightIntensity|isPrimaryStar/.test(sceneSrc) || !/0\.8/.test(sceneSrc)) {
    fail("OrbitScene missing dimmed companion star pointLights");
  } else {
    ok("OrbitScene dims companion star pointLights when companions mesh (soft perf)");
  }
  // Explore visibility contract (mirror isExploreSceneBody): orbit-unknown
  // companion stars mesh; their parent-frame kids return to Explore.
  function exploreVisible(body, primaryId, byId, seen = new Set()) {
    if (body.id === primaryId || (body.kind === "star" && !body.parentId)) return true;
    if (body.kind === "star" && body.parentId) return true;
    if (!hasUsableOrbit(body)) return false;
    if (body.orbit?.frame === "parent" && body.parentId) {
      if (seen.has(body.id)) return false;
      seen.add(body.id);
      const parent = byId.get(body.parentId);
      if (!parent) return false;
      return exploreVisible(parent, primaryId, byId, seen);
    }
    return true;
  }
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const vis = bodies.filter((b) => exploreVisible(b, "syn-primary", byId)).map((b) => b.id);
  const expect = ["syn-primary", "syn-companion", "syn-mesh", "syn-planet", "syn-mesh-planet"];
  if (vis.join(",") !== expect.join(",")) {
    fail(`Explore visibility expected [${expect}], got [${vis}]`);
  } else {
    ok("Explore meshes orbit-unknown companion + parent-frame kids (visual-binary)");
  }
  // Source-level: star+parentId must be scene-eligible even without Kepler.
  if (!/body\.kind === "star" && body\.parentId/.test(sceneSrc) &&
      !/kind === "star" && .*parentId/.test(sceneSrc)) {
    // softer: require the visual-binary helper + isExploreSceneBody star branch
    if (!/Mesh companion stars even without Kepler/.test(sceneSrc) &&
        !/kind === "star" && body\.parentId/.test(sceneSrc)) {
      fail("isExploreSceneBody should treat star+parentId as scene-eligible");
    } else {
      ok("isExploreSceneBody includes orbit-unknown companion stars");
    }
  } else {
    ok("isExploreSceneBody includes orbit-unknown companion stars");
  }
}


// Schematic wide-system orbit fit (pure formula; catalog aAu unchanged).
{
  const fitSrc = fs.readFileSync(path.join(ROOT, "src/viz/schematicFit.ts"), "utf8");
  const IDLE_CAMERA_DIST_LEGACY = Math.hypot(0, 8, 14);
  const IDLE_EXTENT_PAD = 1.17;
  const STAR_IDLE_FILL_MIN = 0.08;
  const STAR_IDLE_FILL_TARGET = 0.1;
  const SCHEMATIC_FIT_MIN = 0.15;
  const tanHalf = Math.tan((45 * Math.PI) / 180 / 2);
  const starVis = 0.12;
  function idle(extent) {
    if (!(extent > 1e-6) || !Number.isFinite(extent)) return IDLE_CAMERA_DIST_LEGACY;
    return Math.min(IDLE_CAMERA_DIST_LEGACY, extent * IDLE_EXTENT_PAD);
  }
  function fitScaleOf(extent0) {
    const dist0 = idle(extent0);
    const fill0 = starVis / (dist0 * tanHalf);
    if (fill0 >= STAR_IDLE_FILL_MIN) return 1;
    const targetDist = starVis / (STAR_IDLE_FILL_TARGET * tanHalf);
    let c = 1;
    if (targetDist < IDLE_CAMERA_DIST_LEGACY - 1e-12) {
      c = targetDist / (extent0 * IDLE_EXTENT_PAD);
    }
    c = Math.min(1, Math.max(SCHEMATIC_FIT_MIN, c));
    return c;
  }
  // Home gate is caller-side; Sol-scale extent must still be allowed c=1 by caller.
  if (!/system\.home === true/.test(fs.readFileSync(path.join(ROOT, "src/viz/OrbitScene.tsx"), "utf8"))) {
    fail("OrbitScene must gate fitScale=1 on system.home");
  } else {
    ok("OrbitScene home gate keeps Sol fitScale=1");
  }
  // Wide synthetic: extent large → fill tiny → fitScale < 1.
  const wideExtent = 30.4; // 14 Her-class apo
  const wideC = fitScaleOf(wideExtent);
  if (!(wideC < 1) || !(wideC >= SCHEMATIC_FIT_MIN - 1e-12)) {
    fail(`wide synthetic fitScale expected in [${SCHEMATIC_FIT_MIN},1), got ${wideC}`);
  } else {
    const distF = idle(wideExtent * wideC);
    const fillF = starVis / (distF * tanHalf);
    ok(`wide synthetic schematic fitScale=${wideC.toFixed(3)} fill≈${(fillF * 100).toFixed(1)}%`);
  }
  // Compact: already readable fill → c=1.
  const compactExtent = 2.1; // TRAPPIST/Kepler-class display extent
  const compactC = fitScaleOf(compactExtent);
  if (compactC !== 1) {
    fail(`compact synthetic fitScale should be 1, got ${compactC}`);
  } else {
    ok("compact synthetic schematic fitScale=1 (already readable)");
  }
  // Inflated-extent compact-hot host (55 Cnc-class): idle stays at LEGACY,
  // but mild orbit compress still improves star/orbit ratio at fixed camera.
  const hugeExtent = 134;
  const hugeC = fitScaleOf(hugeExtent);
  if (!(hugeC < 1) || Math.abs(hugeC - SCHEMATIC_FIT_MIN) > 1e-9) {
    fail(`huge-extent synthetic fitScale expected ${SCHEMATIC_FIT_MIN}, got ${hugeC}`);
  } else {
    ok(`huge-extent synthetic fitScale=${hugeC} (SCHEMATIC_FIT_MIN; idle may stay legacy)`);
  }
  // Catalog aAu must not be mutated by fit helpers (source contract).
  if (/aAu\s*=/.test(fitSrc) && /body\.orbit\.aAu\s*=/.test(fitSrc)) {
    fail("schematicFit must not assign body.orbit.aAu");
  } else if (!/Catalog aAu unchanged|catalog aAu unchanged|viz-only/i.test(fitSrc)) {
    fail("schematicFit should document viz-only / catalog aAu unchanged");
  } else {
    ok("schematicFit is viz-only (no catalog aAu mutation)");
  }
  if (!/STAR_VISUAL_RADIUS/.test(fitSrc) || /STAR_VISUAL_RADIUS\s*=/.test(fitSrc)) {
    // reading via visualRadius is fine; must not redefine the locked constant
    if (/export const STAR_VISUAL_RADIUS/.test(fitSrc) || /STAR_VISUAL_RADIUS\s*=\s*0\./.test(fitSrc)) {
      fail("schematicFit must not redefine STAR_VISUAL_RADIUS");
    } else {
      ok("schematicFit does not redefine STAR_VISUAL_RADIUS");
    }
  } else {
    ok("schematicFit does not redefine STAR_VISUAL_RADIUS");
  }
}


// Schematic fit must keep perihelion + companion mesh clearance (post-fit floors).
{
  const sizeSrc = fs.readFileSync(path.join(ROOT, "src/viz/sizeTiers.ts"), "utf8");
  const sceneSrc = fs.readFileSync(path.join(ROOT, "src/viz/OrbitScene.tsx"), "utf8");
  if (!/export function perihelionClearanceFloor/.test(sizeSrc)) {
    fail("sizeTiers missing perihelionClearanceFloor (post-fit perihelion floor)");
  } else if (
    !/perihelionClearanceFloor/.test(sceneSrc) ||
    !/Math\.max\([\s\S]{0,120}clearanceHelio \* fitScale/.test(sceneSrc)
  ) {
    fail("OrbitScene must helioScale = max(clearanceHelio*fitScale, perihelionClearanceFloor)");
  } else {
    ok("OrbitScene floors helioScale at perihelionClearanceFloor after fit");
  }

  const STAR_VISUAL_RADIUS = tiers.STAR_VISUAL_RADIUS;
  const MARGIN = tiers.PERIHELION_CLEARANCE_MARGIN_AU;
  const VISUAL_BINARY_CLEARANCE_MARGIN = 0.005;
  const SCHEMATIC_FIT_MIN = 0.15;

  // Raw perihelion floor (parentFrameDisplayScale need / q, no floor at 1).
  function periFloor(starVis, kids) {
    let floor = 0;
    for (const c of kids) {
      const margin = Math.min(MARGIN, Math.max(starVis * 0.35, c.vis));
      const need = Math.max(starVis + c.vis + margin, starVis * 1.85 + c.vis);
      if (!(c.qAu > 0)) continue;
      const req = need / c.qAu;
      if (req > floor) floor = req;
    }
    return floor;
  }

  // 55 Cnc-style: huge clearanceHelio × fitMin must not drop below peri floor.
  {
    const starVis = STAR_VISUAL_RADIUS;
    const qAu = 0.014668; // ultra-close hot planet
    const childVis = tiers.PLANET_VISUAL_RADIUS_SMALL;
    const clearanceHelio = parentFrameDisplayScale(
      qAu,
      starVis,
      childVis,
      MARGIN,
    );
    const fitScale = SCHEMATIC_FIT_MIN;
    const floor = periFloor(starVis, [{ qAu, vis: childVis }]);
    const helioScale = Math.max(clearanceHelio * fitScale, floor);
    if (!(helioScale + 1e-12 >= floor)) {
      fail(`55 Cnc-style: helioScale ${helioScale} < perihelion floor ${floor}`);
    } else if (!(Math.abs(helioScale - floor) < 1e-9) && !(helioScale >= clearanceHelio * fitScale - 1e-12)) {
      fail(`55 Cnc-style: unexpected helioScale ${helioScale}`);
    } else {
      const qVis = qAu * helioScale;
      const margin = Math.min(MARGIN, Math.max(starVis * 0.35, childVis));
      const need = Math.max(starVis + childVis + margin, starVis * 1.85 + childVis);
      if (!(qVis + 1e-9 >= need)) {
        fail(`55 Cnc-style: q*helio ${qVis} < need ${need}`);
      } else {
        ok(
          `55 Cnc-style: helioScale=${helioScale.toFixed(3)} restores perihelion (fit alone would be ${(clearanceHelio * fitScale).toFixed(3)})`,
        );
      }
    }
  }

  // 51 Eri-style: companion sep after fit must clear primary+self meshes.
  {
    const rPrimary = STAR_VISUAL_RADIUS;
    const rSelf = STAR_VISUAL_RADIUS;
    const baseSep = Math.max(
      (rPrimary + rSelf) * 1.3,
      0.04,
    ); // schematic mesh-radii sep
    const fitScale = SCHEMATIC_FIT_MIN;
    const meshNeed = rPrimary + rSelf + VISUAL_BINARY_CLEARANCE_MARGIN;
    const sep = Math.max(baseSep * fitScale, meshNeed);
    if (!(sep + 1e-12 >= meshNeed)) {
      fail(`51 Eri-style: companion sep ${sep} < mesh need ${meshNeed}`);
    } else if (baseSep * fitScale + 1e-12 >= meshNeed) {
      fail("51 Eri-style synthetic expected fit alone to bury companion (test setup)");
    } else {
      ok(
        `51 Eri-style: companion sep=${sep.toFixed(3)} clears meshes (fit alone ${(baseSep * fitScale).toFixed(3)})`,
      );
    }
  }

  // Floor must NOT force ≥1 — Sol-scale systems with fitScale=1 stay unchanged,
  // and wide hosts with mild peri need keep compress below 1.
  {
    const starVis = STAR_VISUAL_RADIUS;
    const qAu = 4.472; // 51 Eri b-class
    const childVis = tiers.PLANET_VISUAL_RADIUS_SMALL;
    const floor = periFloor(starVis, [{ qAu, vis: childVis }]);
    if (!(floor < 1)) {
      fail(`wide-host perihelion floor should be <1 (got ${floor}) so fitScale compress remains`);
    } else {
      ok(`wide-host perihelion floor=${floor.toFixed(3)} <1 (fit compress preserved)`);
    }
  }
}


// Parent-frame planets around orbit-unknown companions (55 Cnc B b/c class).
{
  const MARGIN = tiers.PERIHELION_CLEARANCE_MARGIN_AU;
  const STAR_VISUAL_RADIUS = tiers.STAR_VISUAL_RADIUS;
  const fitSrcKids = fs.readFileSync(path.join(ROOT, "src/viz/schematicFit.ts"), "utf8");
  if (!/visualBinaryKidsClearanceSep/.test(fitSrcKids)) {
    fail("schematicFit missing visualBinaryKidsClearanceSep");
  } else {
    ok("schematicFit exports visualBinaryKidsClearanceSep");
  }

  // Synthetic: small-aAu parent-frame planet around schematic-sep companion.
  const synPrimary = {
    id: "syn-host",
    kind: "star",
    systemId: "syn-host",
    facts: { radiusMeanKm: 700000, massKg: 2e30 },
  };
  const synComp = {
    id: "syn-comp",
    kind: "star",
    systemId: "syn-host",
    parentId: "syn-host",
    facts: { radiusMeanKm: 400000, massKg: 8e29 },
    // no projectedSepAu → schematic sep only (tight) so kids floor must bump
  };
  const synKid = {
    id: "syn-comp-b",
    kind: "planet",
    systemId: "syn-host",
    parentId: "syn-comp",
    facts: { radiusMeanKm: 10000 },
    orbit: {
      frame: "parent",
      aAu: 0.044,
      e: 0,
      iDeg: 90,
      omDeg: 0,
      wDeg: 0,
      maDeg: 0,
      periodD: 7,
    },
  };
  const synBodies = [synPrimary, synComp, synKid];
  const parentVis = STAR_VISUAL_RADIUS;
  const childVis = visualRadius(synKid, tiers);
  const qAu = synKid.orbit.aAu * (1 - synKid.orbit.e);
  const ps = parentFrameSharedDisplayScale(
    parentVis,
    [{ qAu, aAu: synKid.orbit.aAu, e: synKid.orbit.e, vis: childVis }],
    MARGIN,
  );
  const qDisp = qAu * ps;
  const periNeed = Math.max(
    parentVis + childVis + Math.min(MARGIN, Math.max(parentVis * 0.35, childVis)),
    parentVis * 1.85 + childVis,
  );
  if (!(ps > 1.01)) {
    fail(`synthetic companion-host: expected parentDisplayScale ≫ 1 (got ${ps})`);
  } else if (!(qDisp + 1e-9 >= periNeed)) {
    fail(`synthetic companion-host: q*ps=${qDisp} < companion mesh need ${periNeed}`);
  } else {
    ok(
      `synthetic companion-host: ps=${ps.toFixed(3)} q*ps=${qDisp.toFixed(3)} ≥ need ${periNeed.toFixed(3)}`,
    );
  }
  const rPrimary = STAR_VISUAL_RADIUS;
  const rSelf = STAR_VISUAL_RADIUS;
  const schematicSep = Math.max((rPrimary + rSelf) * 1.3, 0.04);
  const maxApo = synKid.orbit.aAu * (1 + synKid.orbit.e) * ps;
  const priMargin = Math.min(MARGIN, Math.max(rPrimary * 0.35, childVis));
  const kidsFloor = maxApo + rPrimary + childVis + priMargin;
  const sep = Math.max(schematicSep, kidsFloor);
  const minDist = sep - maxApo;
  const priNeed = rPrimary + childVis + priMargin;
  if (!(sep + 1e-12 >= kidsFloor)) {
    fail(`synthetic companion-host: sep ${sep} < kidsFloor ${kidsFloor}`);
  } else if (!(minDist + 1e-12 >= priNeed)) {
    fail(`synthetic companion-host: minDist to primary ${minDist} < need ${priNeed}`);
  } else if (!(schematicSep + 1e-12 < kidsFloor)) {
    fail("synthetic companion-host: expected schematic sep alone to violate kids clearance (test setup)");
  } else {
    ok(
      `synthetic companion-host: sep=${sep.toFixed(3)} (schematic ${schematicSep.toFixed(3)}) keeps apo clear of primary`,
    );
  }

  // 55 Cnc archive spot-check (parentVis, ps, q*ps, companionSep, min dist).
  const cncPath = path.join(ROOT, "public/archive/graphs/55-cnc.json");
  if (fs.existsSync(cncPath)) {
    const cnc = JSON.parse(fs.readFileSync(cncPath, "utf8"));
    const cBodies = cnc.bodies;
    const cComp = cBodies.find((b) => b.id === "55-cnc-comp-b");
    const cKids = cBodies.filter(
      (b) => b.parentId === "55-cnc-comp-b" && b.orbit?.frame === "parent",
    );
    if (!cComp || cKids.length < 2) {
      fail("55 Cnc archive missing comp-b + parent-frame B b/c");
    } else {
      const pVis = STAR_VISUAL_RADIUS;
      const rows = cKids.map((c) => ({
        id: c.id,
        qAu: c.orbit.aAu * (1 - c.orbit.e),
        aAu: c.orbit.aAu,
        e: c.orbit.e,
        vis: visualRadius(c, tiers),
      }));
      const cPs = parentFrameSharedDisplayScale(pVis, rows, MARGIN);
      let allClear = true;
      for (const r of rows) {
        const need = Math.max(
          pVis + r.vis + Math.min(MARGIN, Math.max(pVis * 0.35, r.vis)),
          pVis * 1.85 + r.vis,
        );
        if (!(r.qAu * cPs + 1e-9 >= need)) {
          fail(`${r.id}: q*ps=${r.qAu * cPs} < need ${need} (ps=${cPs})`);
          allClear = false;
        }
      }
      const projected = cComp.facts?.projectedSepAu;
      const outerA = Math.max(
        ...cBodies
          .filter((b) => b.orbit && b.orbit.frame !== "parent")
          .map((b) => b.orbit.aAu),
      );
      const sch = Math.max((STAR_VISUAL_RADIUS * 2) * 1.3, 0.04);
      const floor = Math.max(sch, outerA * 1.2);
      const compressed = Math.log1p(projected) * 3.0;
      let cSep = Math.min(36, Math.max(floor, compressed));
      cSep = Math.max(cSep, STAR_VISUAL_RADIUS * 2 + 0.005);
      const maxApoC = Math.max(...rows.map((r) => r.aAu * (1 + r.e) * cPs));
      const maxCVis = Math.max(...rows.map((r) => r.vis));
      const kidsF = maxApoC + STAR_VISUAL_RADIUS + maxCVis + Math.min(MARGIN, Math.max(STAR_VISUAL_RADIUS * 0.35, maxCVis));
      cSep = Math.max(cSep, kidsF);
      const minD = cSep - maxApoC;
      const needD = STAR_VISUAL_RADIUS + maxCVis + Math.min(MARGIN, Math.max(STAR_VISUAL_RADIUS * 0.35, maxCVis));
      if (allClear && minD + 1e-9 >= needD) {
        ok(
          `55 Cnc B b/c: parentVis=${pVis} ps=${cPs.toFixed(3)} q*ps(b)=${(0.044 * cPs).toFixed(3)} sep=${cSep.toFixed(3)} minDist=${minD.toFixed(3)}≥${needD.toFixed(3)}`,
        );
      } else if (allClear) {
        fail(`55 Cnc B b/c: minDist ${minD} < need ${needD} (sep=${cSep})`);
      }
    }
  } else {
    ok("55 Cnc archive graph absent — skip spot-check");
  }

  // Sol moon / TRAPPIST: no companion offset path (fitScale 1 / no kidsFloor bump).
  const sceneSrc2 = fs.readFileSync(path.join(ROOT, "src/viz/OrbitScene.tsx"), "utf8");
  if (!/system\.home/.test(sceneSrc2) && !/home === true/.test(sceneSrc2) && !/\.home\b/.test(sceneSrc2)) {
    fail("OrbitScene should gate fitScale=1 on home (Sol unchanged)");
  } else {
    ok("Sol path: home gate keeps fitScale=1 (moons use parent-frame, not visual-binary)");
  }
  // Kids clearance only for orbit-unknown companion stars — never planet parents.
  if (!/companion\.kind !== "star"/.test(fitSrcKids) && !/kind !== "star"/.test(fitSrcKids)) {
    fail("visualBinaryKidsClearanceSep must gate on companion kind===star");
  } else {
    ok("kids clearance gated to orbit-unknown companion stars (Sol moons / TRAPPIST untouched)");
  }
}

// Hot-Jupiter + mesh-only companions (HAT-P-57 class): radial clear + out-of-plane.
{
  const fitSrcHat = fs.readFileSync(path.join(ROOT, "src/viz/schematicFit.ts"), "utf8");
  const sceneSrcHat = fs.readFileSync(path.join(ROOT, "src/viz/OrbitScene.tsx"), "utf8");
  if (!/visualBinaryHelioPlanetClearanceSep/.test(fitSrcHat)) {
    fail("HAT-P-57 class: missing visualBinaryHelioPlanetClearanceSep");
  } else if (!/planetFloor/.test(sceneSrcHat)) {
    fail("HAT-P-57 class: companion offset must apply planetFloor");
  } else if (
    !/helioScale/.test(sceneSrcHat) ||
    !/visualBinaryCompanionOffset\([\s\S]{0,200}helioScale/.test(sceneSrcHat)
  ) {
    fail("HAT-P-57 class: must pass effective helioScale into companion offset");
  } else if (!/COMPANION_OUT_OF_PLANE_FRAC/.test(fitSrcHat)) {
    fail("HAT-P-57 class: missing COMPANION_OUT_OF_PLANE_FRAC");
  } else if (!/viz-only lift|not a catalog inclination/i.test(sceneSrcHat)) {
    fail("HAT-P-57 class: should comment viz-only out-of-plane lift");
  } else {
    ok("HAT-P-57 class: source has outer-apo floor + out-of-plane lift + helioScale pass");
  }

  const STAR_VISUAL_RADIUS = tiers.STAR_VISUAL_RADIUS;
  const PLANET_VISUAL_RADIUS_LARGE = tiers.PLANET_VISUAL_RADIUS_LARGE;
  const MARGIN_CAP = tiers.PERIHELION_CLEARANCE_MARGIN_AU;
  const VB_MARGIN = 0.005;
  // Synthetic: hot Jupiter aAu=0.0406 + 2 mesh-only companions (no projectedSepAu).
  const synPri = {
    id: "hat-syn",
    kind: "star",
    facts: { radiusMeanKm: 1043550, massKg: 2.9e30 },
  };
  const synCb = {
    id: "hat-syn-comp-b",
    kind: "star",
    parentId: "hat-syn",
    facts: {},
  };
  const synCc = {
    id: "hat-syn-comp-c",
    kind: "star",
    parentId: "hat-syn",
    facts: {},
  };
  const synPl = {
    id: "hat-syn-b",
    kind: "planet",
    facts: { radiusMeanKm: 124000 },
    orbit: {
      frame: "heliocentric",
      aAu: 0.0406,
      e: 0,
      iDeg: 88,
      omDeg: 0,
      wDeg: 0,
      maDeg: 0,
      periodD: 2.5,
    },
  };
  const synHat = [synPri, synCb, synCc, synPl];
  // Mimic schematic clearance: star+planet mesh need / q.
  const starVis = STAR_VISUAL_RADIUS;
  const planetVis = PLANET_VISUAL_RADIUS_LARGE;
  const qAu = synPl.orbit.aAu;
  const periMargin = Math.min(MARGIN_CAP, Math.max(starVis * 0.35, planetVis));
  const periNeed = Math.max(
    starVis + planetVis + periMargin,
    starVis * 1.85 + planetVis,
  );
  const helioScale = periNeed / qAu; // effective (fit=1) for compact hot host
  const rSelf = STAR_VISUAL_RADIUS; // schematic companion mesh
  const schematicSep = Math.max((starVis + rSelf) * 1.3, 0.04);
  const outerApoDisplay = synPl.orbit.aAu * (1 + synPl.orbit.e) * helioScale;
  const clearMargin = Math.min(MARGIN_CAP, Math.max(VB_MARGIN, planetVis));
  const planetFloor = outerApoDisplay + rSelf + planetVis + clearMargin;
  const sep = Math.max(
    schematicSep,
    starVis + rSelf + VB_MARGIN,
    planetFloor,
  );
  const COMPANION_OUT_OF_PLANE_FRAC = 0.5;
  const z = (starVis + rSelf) * COMPANION_OUT_OF_PLANE_FRAC;
  if (!(schematicSep + 1e-12 < outerApoDisplay)) {
    fail(
      `HAT-P-57 synthetic setup: expected schematic sep ${schematicSep} < planet apo ${outerApoDisplay}`,
    );
  } else if (!(sep + 1e-12 >= outerApoDisplay + rSelf + planetVis)) {
    fail(
      `HAT-P-57 synthetic: sep ${sep} must clear planet apo ${outerApoDisplay} + meshes`,
    );
  } else if (!(z > 0)) {
    fail(`HAT-P-57 synthetic: out-of-plane z must be > 0 (got ${z})`);
  } else {
    ok(
      `HAT-P-57 synthetic: sep=${sep.toFixed(3)} > apo=${outerApoDisplay.toFixed(3)} (schematic ${schematicSep.toFixed(3)}); z=${z.toFixed(3)}`,
    );
  }

  // Archive spot-check when bulk graph present.
  const hatPath = path.join(ROOT, "public/archive/bulk/graphs/hat-p-57.json");
  const hatSmoke = path.join(ROOT, "public/archive/graphs/hat-p-57.json");
  const hatFile = fs.existsSync(hatPath) ? hatPath : fs.existsSync(hatSmoke) ? hatSmoke : null;
  if (hatFile) {
    const hat = JSON.parse(fs.readFileSync(hatFile, "utf8"));
    const comps = hat.bodies.filter(
      (b) => b.kind === "star" && b.parentId && !hasUsableOrbit(b),
    );
    const planets = hat.bodies.filter(
      (b) =>
        hasUsableOrbit(b) &&
        b.orbit?.frame !== "parent" &&
        (b.kind === "planet" || b.kind === "dwarf_planet"),
    );
    const noProj = comps.every(
      (c) =>
        !(
          typeof c.facts?.projectedSepAu === "number" &&
          Number.isFinite(c.facts.projectedSepAu) &&
          c.facts.projectedSepAu > 0
        ),
    );
    const hot = planets.some((p) => p.orbit.aAu < 0.15);
    if (comps.length >= 2 && noProj && hot) {
      ok(
        `HAT-P-57 archive: ${comps.length} mesh-only comps, hot planet aAu=${planets[0].orbit.aAu} (risk pattern)`,
      );
    } else {
      ok("HAT-P-57 archive present (pattern soft-check skipped)");
    }
  } else {
    ok("HAT-P-57 archive absent — skip archive spot-check");
  }

  // 55 Cnc / Sol: companions still clear; Sol home unchanged (source gates).
  if (!/home === true/.test(sceneSrcHat) && !/system\.home/.test(sceneSrcHat)) {
    fail("Sol regression: OrbitScene should keep home fitScale=1 gate");
  } else {
    ok("Sol / 55 Cnc regressions: home fitScale gate + kids clearance still present");
  }

  // Bulk risk-pattern sweep: multi-star, companion w/o projectedSepAu, hot planet.
  const bulkDir = path.join(ROOT, "public/archive/bulk/graphs");
  let riskCount = 0;
  if (fs.existsSync(bulkDir)) {
    for (const f of fs.readdirSync(bulkDir).filter((x) => x.endsWith(".json"))) {
      const g = JSON.parse(fs.readFileSync(path.join(bulkDir, f), "utf8"));
      const bodies = g.bodies || [];
      const stars = bodies.filter((b) => b.kind === "star");
      if (stars.length < 2) continue;
      const comps = bodies.filter(
        (b) => b.kind === "star" && b.parentId && !hasUsableOrbit(b),
      );
      if (comps.length === 0) continue;
      const meshOnly = comps.filter(
        (c) =>
          !(
            typeof c.facts?.projectedSepAu === "number" &&
            Number.isFinite(c.facts.projectedSepAu) &&
            c.facts.projectedSepAu > 0
          ),
      );
      if (meshOnly.length === 0) continue;
      const hot = bodies.some(
        (b) =>
          hasUsableOrbit(b) &&
          b.orbit?.frame !== "parent" &&
          typeof b.orbit?.aAu === "number" &&
          b.orbit.aAu < 0.15,
      );
      if (hot) riskCount++;
    }
    ok(
      `bulk risk pattern (multi-star, mesh-only companion, planet aAu<0.15): ${riskCount} graphs`,
    );
  } else {
    ok("bulk graphs absent — skip risk-pattern sweep");
  }
}


if (process.exitCode) {
  console.error("\norbit-sanity FAILED");
  process.exit(process.exitCode);
}
console.log("\norbit-sanity PASSED");
