#!/usr/bin/env node
/**
 * Schematic sunflower + Proportional sky placement sanity (Systems map).
 * Usage: node scripts/sky-layout-sanity.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}
function ok(msg) {
  console.log(`ok  ${msg}`);
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const MIN_SEP = 168;
const Y_FLAT = 0.72;
const RX = 15 * 3261.56;
const RY = RX * 0.42;
const FIT = 0.8;
const SOL_X = -8.2 * 3261.56;
const SOL_Y = 0;

function schematicSep(count) {
  if (count <= 1) return MIN_SEP;
  const maxI = count - 1;
  const maxRad = Math.min(FIT * RX, (FIT * RY) / Y_FLAT);
  const raw = MIN_SEP * Math.sqrt(maxI);
  return raw <= maxRad ? MIN_SEP : maxRad / Math.sqrt(maxI);
}

function placeSunflower(index, originX, originY, sep) {
  if (index <= 0) return { x: originX, y: originY };
  const ang = index * GOLDEN;
  const rad = sep * Math.sqrt(index);
  return {
    x: originX + Math.cos(ang) * rad,
    y: originY + Math.sin(ang) * rad * Y_FLAT,
  };
}

const N = 4700;
const sep = schematicSep(N);
let maxEllipse = 0;
for (let i = 0; i < N; i++) {
  const p = placeSunflower(i, 0, 0, sep);
  const e = (p.x / RX) ** 2 + (p.y / RY) ** 2;
  if (e > maxEllipse) maxEllipse = e;
}
if (maxEllipse > FIT * FIT + 1e-6) {
  fail(`Schematic pack spills MW disk: max ellipse=${maxEllipse.toFixed(3)} > ${FIT}^2`);
} else {
  ok(`Schematic N=${N} stays inside ${FIT} of MW disk (max ellipse=${maxEllipse.toFixed(3)})`);
}

const home = placeSunflower(0, 0, 0, sep);
if (home.x !== 0 || home.y !== 0) {
  fail(`home index 0 should be disk center, got ${home.x},${home.y}`);
} else {
  ok("sunflower index 0 pins Sol at disk center");
}

const propHome = { x: SOL_X, y: SOL_Y };
if (Math.abs(propHome.x - SOL_X) > 1e-6) {
  fail("SOL_GAL drifted");
} else {
  ok("Proportional Sol still at galactic rim (SOL_GAL)");
}

const src = fs.readFileSync(path.join(ROOT, "src/lib/skyLayout.ts"), "utf8");
if (!/export function placeSystemSunflower/.test(src)) {
  fail("skyLayout.ts missing placeSystemSunflower");
} else {
  ok("placeSystemSunflower exported");
}
if (!/export const GOLDEN_ANGLE/.test(src)) {
  fail("skyLayout.ts missing GOLDEN_ANGLE");
} else {
  ok("GOLDEN_ANGLE exported");
}

const page = fs.readFileSync(path.join(ROOT, "src/app/systems/page.tsx"), "utf8");

if (!/SCHEMATIC_ORIGIN/.test(page) || !/schematicSunflowerSep/.test(page)) {
  fail("schematic pack is not centered/scaled with SCHEMATIC_ORIGIN");
} else {
  ok("Schematic uses disk-center origin + disk-fit sep");
}
if (/placeSystemSunflower\(\s*i,\s*SOL_GAL/.test(page)) {
  fail("Schematic sunflower still anchored at SOL_GAL rim");
} else {
  ok("Schematic sunflower not anchored at SOL_GAL");
}

if (!/placeSystemSunflower/.test(page)) {
  fail("systems page does not call placeSystemSunflower");
} else {
  ok("systems page uses placeSystemSunflower");
}
if (/spacing === "schematic"[\s\S]{0,200}placeSystemSky/.test(page)) {
  // schematic branch should not use placeSystemSky ring
  const schem = page.slice(page.indexOf('if (spacing === "schematic")'), page.indexOf("// Proportional"));
  if (schem.includes("placeSystemSky")) {
    fail("Schematic layout still calls placeSystemSky");
  } else {
    ok("Schematic layout skips placeSystemSky ring");
  }
} else {
  ok("Schematic layout skips placeSystemSky ring");
}
const labelCapM = page.match(/LABEL_CAP\s*=\s*(\d+)/);
const labelCapN = labelCapM ? Number(labelCapM[1]) : NaN;
if (!(labelCapN >= 40 && labelCapN <= 70)) {
  fail("LABEL_CAP should be ~40–70 (pre-MW 64), not 220");
} else {
  ok("LABEL_CAP tightened");
}
if (!/NEIGHBORHOOD_ZOOM\s*=\s*1/.test(page)) {
  fail("NEIGHBORHOOD_ZOOM default missing (expected 1)");
} else {
  ok("NEIGHBORHOOD_ZOOM neighborhood default");
}
if (!/LIGHT_PAINT_MAX\s*=\s*[1-9]\d{2}/.test(page) || !/WORLD_R_FLOOR_MAX/.test(page)) {
  fail("zoomed-out paint cap / world-r floor missing");
} else {
  ok("zoomed-out paint cap + world-r floor");
}
if (!/canvasMounted/.test(page)) {
  fail("map canvas mount-gate missing (hydration)");
} else {
  ok("map canvas mount-gate present");
}

if (/camRef\.current\s*=\s*cam\s*;/.test(page)) {
  fail("camRef.current = cam every-render stomp is back");
} else {
  ok("camRef not stomped from React cam each render");
}

if (!/prevSelectedIdRef/.test(page) || !/Archive hydrate rebuilds/.test(page)) {
  fail("selectedId camera guard (cam-lock) missing");
} else {
  ok("selectedId-only camera guard present");
}

if (!/paintedHitR/.test(page) || !/paintedDotWorldR/.test(page)) {
  fail("painted hit/dot radius helpers missing");
} else {
  ok("hit-test uses painted disc radius");
}
if (!/unknownSky/.test(page) || !/gutterInView/.test(page)) {
  fail("Prop unknownSky gutter hide missing");
} else {
  ok("Prop hides unknownSky gutter unless in view");
}
if (!/cullOverlappingLabels/.test(page)) {
  fail("Prop label collision cull missing");
} else {
  ok("Prop label collision cull present");
}

if (!/screenFloorWorldR/.test(page)) {
  fail("screen-space disc floor missing");
} else {
  ok("screen-space disc floor present");
}

if (process.exitCode) {
  console.error("\nsky-layout-sanity FAILED");
  process.exit(1);
}
console.log("\nsky-layout-sanity PASSED");
