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
const SOL_X = -8.2 * 3261.56;
const SOL_Y = 0;

function placeSunflower(index) {
  if (index <= 0) return { x: SOL_X, y: SOL_Y };
  const ang = index * GOLDEN;
  const rad = MIN_SEP * Math.sqrt(index);
  return {
    x: SOL_X + Math.cos(ang) * rad,
    y: SOL_Y + Math.sin(ang) * rad * 0.72,
  };
}

const N = 4700;
let maxR = 0;
for (let i = 0; i < N; i++) {
  const p = placeSunflower(i);
  maxR = Math.max(maxR, Math.hypot(p.x - SOL_X, p.y - SOL_Y));
}
const expect = MIN_SEP * Math.sqrt(N - 1);
if (!(maxR > 8000)) {
  fail(`Schematic sunflower maxR=${maxR} expected ≫ 280 (got order of ${expect})`);
} else {
  ok(`Schematic N=${N} maxR≈${maxR.toFixed(0)} (≳ MIN_SEP*sqrt(N)≈${expect.toFixed(0)}; not SCHEMATIC_R=280)`);
}

const home = placeSunflower(0);
if (home.x !== SOL_X || home.y !== SOL_Y) {
  fail(`home index 0 should be SOL_GAL, got ${home.x},${home.y}`);
} else {
  ok("sunflower index 0 pins Sol");
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
