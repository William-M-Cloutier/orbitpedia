"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import {
  useMemo,
  useCallback,
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  createContext,
  useContext,
  type RefObject,
} from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  EARTH_SATS_SYSTEM_ID,
  getBody,
  getHomeSystem,
  getParent,
  getSystemGraph,
  hasUsableOrbit,
  listChildren,
} from "@/data/catalog";
import { isPrimaryHostKind, type Body, type BodyKind } from "@/data/schema";
import {
  periodFromA,
  positionAtMa,
  sampleOrbit,
  meanOrbitalNormal,
  faceOnRotationFromNormal,
  faceOnRotateEcliptic,
  FACE_ON_IDENTITY,
  type FaceOnRotation,
} from "@/lib/kepler";
import {
  DEFAULT_SIZE_MODE,
  geocentricDisplayScale,
  orbitDistanceScale,
  parentFrameDisplayScale,
  parentFrameSharedDisplayScale,
  heliocentricSharedDisplayScale,
  perihelionClearanceFloor,
  PLANET_VISUAL_RADIUS_SMALL,
  visualRadius,
  type SizeMode,
} from "./sizeTiers";
import {
  IDLE_CAMERA_OFFSET,
  systemSceneExtent,
  maxCompanionDisplaySep,
  schematicOrbitFitScale,
  schematicIdleCameraDistance,
  visualBinaryDisplaySep,
  visualBinaryKidsClearanceSep,
  visualBinaryHelioPlanetClearanceSep,
  probeMarkerDisplaySep,
  hasProbePathWaypoints,
  VISUAL_BINARY_CLEARANCE_MARGIN,
  COMPANION_OUT_OF_PLANE_FRAC,
} from "./schematicFit";
import {
  getBodyAppearanceMaterial,
  getSatPointsMaterial,
  getSatSharedMaterial,
  useRegistryTexture,
} from "./appearance";
import { getPoisForBody } from "@/data/pois";
import { SurfacePoiMarkers } from "./SurfacePoiMarkers";
import {
  assignSatMeshRanks,
  resolveSatLodTier,
  shouldDrawGeocentricOrbitLine,
  SAT_LOD_NEAR_DIST,
  type SatLodTier,
} from "./satLod";

/** Single-vertex buffer for far/dense sat Points impostors (shared). */
const SAT_POINT_POSITION_ATTR = new THREE.BufferAttribute(
  new Float32Array([0, 0, 0]),
  3,
);

/** Must match <Canvas camera.near> — focus floors stay outside the near plane. */
const CAMERA_NEAR = 0.01;

/** Idle offset / distance / extent — see {@link ./schematicFit}. */

type Props = {
  focusId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Selected surface POI id (Explore Facts); markers only on focused body. */
  selectedPoiId?: string | null;
  onSelectPoi?: (id: string | null) => void;
  highlightColor?: string;
  /** Simulated days advanced per real second (idle + follow). UI owns presets. */
  simDaysPerSec?: number;
  /** Mesh size mode — render layer on catalog radii (default schematic). */
  sizeMode?: SizeMode;
  /** Session-only ids with mesh + orbit line suppressed (Explore hide). */
  hiddenIds?: ReadonlySet<string>;
  /** Body kinds whose OrbitLine / ProbePathLine are hidden. */
  hideOrbitPathKinds?: ReadonlySet<BodyKind>;
  /** Hide all probe craft meshes / markers (ProbeBodyMesh). Default false = visible. */
  hideProbeMeshes?: boolean;
  /** Active system graph (default: home). Remount OrbitCanvas on change. */
  systemId?: string;
  /**
   * Canvas-space insets (px) covered by Explore overlays. BodyRail is a flex
   * sibling (outside the canvas) so left is usually 0; Facts overlays the
   * right when a body is selected (~288–320px on md+).
   */
  viewInsetLeft?: number;
  viewInsetRight?: number;
};

type SystemVizApi = {
  bodies: Body[];
  /**
   * Effective primary-frame orbit display scale: clearance helio × schematic
   * fitScale (fitScale=1 for Prop/True and home).
   */
  helioScale: number;
  /**
   * Schematic wide-system orbit compress ∈ (0,1]. Always 1 for home / non-
   * schematic. Companions multiply display sep by this so they track the system.
   */
  fitScale: number;
  /** Viz-only map of system mean orbital plane → ecliptic (face-on Explore). */
  faceOn: FaceOnRotation;
  /** Strong pointLight star — System.primaryStarId or inferred root star. */
  primaryStarId?: string;
};

const SystemVizContext = createContext<SystemVizApi | null>(null);

function useSystemViz(): SystemVizApi {
  const api = useContext(SystemVizContext);
  if (!api) throw new Error("useSystemViz must be used inside SystemVizContext");
  return api;
}

/**
 * Primary-frame display scale for ANY system — delegates to
 * {@link heliocentricSharedDisplayScale} (star clearance + planet/dwarf
 * sibling gaps; asteroids excluded from sibling loop).
 */
/** Primary host = first star|black_hole root (prefer !parentId). */
function findPrimaryHost(bodies: readonly Body[]): Body | undefined {
  return (
    bodies.find((b) => isPrimaryHostKind(b.kind) && !b.parentId) ??
    bodies.find((b) => isPrimaryHostKind(b.kind))
  );
}

function heliocentricDisplayScale(bodies: Body[], sizeMode: SizeMode): number {
  const star = findPrimaryHost(bodies);
  if (!star) return 1;
  const kids = bodies.filter(
    (b) => hasUsableOrbit(b) && b.orbit?.frame !== "parent",
  );
  if (kids.length === 0) return 1;
  return heliocentricSharedDisplayScale(
    visualRadius(star, sizeMode, bodies),
    kids.map((c) => {
      const o = c.orbit!;
      return {
        kind: c.kind,
        qAu: orbitQAu(o),
        aAu: o.aAu,
        e: o.e,
        vis: visualRadius(c, sizeMode, bodies),
      };
    }),
  );
}


/**
 * Face-on rotation from primary planet/dwarf orbits (catalog iDeg unchanged).
 * Asteroids/moons do not define the system plane.
 */
function systemFaceOnRotation(bodies: readonly Body[]): FaceOnRotation {
  const els = bodies
    .filter(
      (b) =>
        hasUsableOrbit(b) &&
        b.orbit?.frame !== "parent" &&
        (b.kind === "planet" || b.kind === "dwarf_planet"),
    )
    .map((b) => b.orbit!);
  if (els.length === 0) return FACE_ON_IDENTITY;
  return faceOnRotationFromNormal(meanOrbitalNormal(els));
}

/** Fallback when UI omits speed — matches Explore Default preset (0.2 d/s = 1 day / 5s). */
const DEFAULT_SIM_DAYS_PER_SEC = 0.2;

const SizeModeContext = createContext<SizeMode>(DEFAULT_SIZE_MODE);
function useSizeMode(): SizeMode {
  return useContext(SizeModeContext);
}


type SimApi = {
  /** Shared simulated days since Explore mounted (paused while tab hidden). */
  getSimDays: () => number;
  /** True when focus is an orbiter (ride-along follow). */
  getFollowing: () => boolean;
  getFocusId: () => string | null | undefined;
  /**
   * Barycentric translation currently applied to BarycentricRoot.
   * Frozen while not following an orbiter (see freeze contract).
   */
  getBaryOffset: () => readonly [number, number, number];
};

const SimContext = createContext<SimApi | null>(null);

function useSimApi(): SimApi {
  const api = useContext(SimContext);
  if (!api) {
    throw new Error("useSimApi must be used inside SimProvider");
  }
  return api;
}

/** True when focus has usable Kepler elements (primary stars usually false). */
function focusIsOrbiter(focusId?: string | null): boolean {
  if (!focusId) return false;
  const b = getBody(focusId);
  return Boolean(b && hasUsableOrbit(b));
}

function eclipticToScene(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y];
}

/** Ecliptic AU → scene, after optional system face-on rotation. */
function eclipticToSceneFaceOn(
  faceOn: FaceOnRotation,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const [fx, fy, fz] = faceOnRotateEcliptic(faceOn, x, y, z);
  return eclipticToScene(fx, fy, fz);
}

/**
 * Viz-only barycentric sun wobble (NOT a catalog heliocentric orbit).
 * Small circular offset in the ecliptic so the sun is not glued to the origin;
 * orbit-sanity still requires sun.orbit absent — do not draw an OrbitLine.
 */
const SUN_WOBBLE_RADIUS_AU = 0.035;
/** Sidereal period for the marker orbit (days). Short enough to read at 0.2 d/s. */
const SUN_WOBBLE_PERIOD_D = 90;

function sunBarycentricOffset(
  simDays: number,
  distScale: number = 1,
  faceOn: FaceOnRotation = FACE_ON_IDENTITY,
): [number, number, number] {
  const s = distScale > 0 ? distScale : 1;
  const ang = (2 * Math.PI * simDays) / SUN_WOBBLE_PERIOD_D;
  const x = SUN_WOBBLE_RADIUS_AU * s * Math.cos(ang);
  const y = SUN_WOBBLE_RADIUS_AU * s * Math.sin(ang);
  return eclipticToSceneFaceOn(faceOn, x, y, 0);
}

/**
 * Periapsis (au) from elements — matches catalog qAu when present.
 */
function orbitQAu(orbit: NonNullable<Body["orbit"]>): number {
  if (orbit.qAu != null && Number.isFinite(orbit.qAu)) return orbit.qAu;
  return orbit.aAu * (1 - orbit.e);
}

/**
 * Prefer the active Explore graph for parent resolution. Archive session
 * getters can miss during graph swaps; systemBodies is the live members list.
 */
function resolveParentBody(
  body: Body,
  systemBodies?: readonly Body[],
): Body | undefined {
  if (!body.parentId) return undefined;
  return (
    systemBodies?.find((b) => b.id === body.parentId) ??
    getParent(body.id) ??
    getBody(body.parentId)
  );
}

/**
 * Viz-only parent-frame orbit inflate. Shared per parent so Galileans / etc.
 * keep relative spacing instead of each child independently mapping to the
 * same display periapsis (catalog a/e/i unchanged).
 */
function parentDisplayScale(
  body: Body,
  sizeMode: SizeMode,
  systemBodies?: readonly Body[],
): number {
  if (body.orbit?.frame !== "parent" || !body.parentId) return 1;
  const parent = resolveParentBody(body, systemBodies);
  if (!parent) return 1;
  const pool =
    systemBodies && systemBodies.length > 0
      ? systemBodies.filter((c) => c.parentId === parent.id)
      : listChildren(parent.id);
  const kids = pool.filter(
    (c) => c.orbit?.frame === "parent" && hasUsableOrbit(c),
  );
  if (kids.length === 0) return 1;
  const bodies =
    systemBodies && systemBodies.length > 0
      ? systemBodies
      : getSystemGraph(parent.systemId).bodies;
  return parentFrameSharedDisplayScale(
    visualRadius(parent, sizeMode, bodies),
    kids.map((c) => {
      const o = c.orbit!;
      return {
        qAu: orbitQAu(o),
        aAu: o.aAu,
        e: o.e,
        vis: visualRadius(c, sizeMode, bodies),
      };
    }),
  );
}


/**
 * Scene-local Kepler position for one body's own elements (no parent offset).
 * `relScale` folds orbitDistanceScale and optional parent-frame display scale.
 */
function localOrbitPosition(
  body: Body,
  simDays: number,
  relScale: number,
  faceOn: FaceOnRotation = FACE_ON_IDENTITY,
): [number, number, number] {
  // No usable elements → origin; Kepler companions move. Orbit-unknown companions
  // use visualBinaryCompanionOffset via bodyPosition — never invent elements here.
  if (!hasUsableOrbit(body)) return [0, 0, 0];
  const period = body.orbit.periodD ?? periodFromA(body.orbit.aAu);
  const ma = body.orbit.maDeg + (360 * simDays) / period;
  const [x, y, z] = positionAtMa(body.orbit, ma);
  const s = relScale > 0 ? relScale : 1;
  return eclipticToSceneFaceOn(faceOn, x * s, y * s, z * s);
}

/**
 * Viz-only display ring for orbit-unknown companion stars in Explore's
 * face-on plane. NOT an orbit — no OrbitLine, no invented aAu/period.
 * Smoke archive: 17/17 multi-star systems have companions with no usable
 * Kepler; bulk: 0/425 multi-star graphs have companion orbit.aAu.
 * Prefer real Kepler via hasUsableOrbit when archive has elements.
 *
 * Separation (scene AU; orbitDistanceScale is 1 today, same as Kepler XYZ):
 * - No facts.projectedSepAu → schematic (rPrimary + rSelf) *
 *   VISUAL_BINARY_SEP_FACTOR with MIN_SEP floor.
 * - Finite projectedSepAu > 0 → **display-scaled** sep (NOT raw catalog AU):
 *   floor = max(schematic, outerPrimaryOrbitA * 1.2) when a primary-frame
 *   usable orbit exists; compress = log1p(projected) * PROJECTED_SEP_LOG_SCALE
 *   (~1000 au → ~20 scene-AU); cap = PROJECTED_SEP_DISPLAY_CAP_AU (~36,
 *   under Explore maxDistance 80). Final =
 *   min(cap, max(floor, compress)), then max(..., rPrimary+rSelf+clearance).
 *   Display-only compression of Gaia/projected sep — catalog AU unchanged;
 *   Facts / Sky still show the true value. log1p is monotonic so multi-
 *   companion relative order is preserved.
 * Schematic fitScale may shrink baseSep; placement then re-floors at
 * rPrimary+rSelf+VISUAL_BINARY_CLEARANCE_MARGIN so companions stay clear.
 * Also floors at outermost primary-frame planet display apo × helioScale
 * (+ companion/planet mesh + margin) so mesh-only companions do not sit on
 * hot-Jupiter rings. Locked sizeTiers / visualRadius contract (incl.
 * companion Prop/True) is respected as-is. Never draw OrbitLine unless
 * hasUsableOrbit.
 *
 * In-plane (x,y) from even angles in the face-on ecliptic — map with
 * eclipticToScene only. Do NOT re-apply faceOn: that rotation is for catalog
 * orbital positions; applying it to ecliptic-XY offsets tips them into
 * vertical in-plane stacking. A small ecliptic-z lift (viz-only; not a
 * catalog inclination) raises companions off the mean orbital plane so they
 * are not coplanar with planet rings.
 */
// Visual-binary sep constants live in schematicFit (shared with fit extent).

function visualBinaryCompanionOffset(
  body: Body,
  sizeMode: SizeMode,
  systemBodies: readonly Body[],
  fitScale: number = 1,
  helioScale: number = 1,
): [number, number, number] {
  if (body.kind !== "star" || !body.parentId || hasUsableOrbit(body)) {
    return [0, 0, 0];
  }
  // Same filter as callers: orbit-unknown companion stars, stable id order.
  const companions = systemBodies
    .filter(
      (b) =>
        b.kind === "star" && Boolean(b.parentId) && !hasUsableOrbit(b),
    )
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const idx = companions.findIndex((c) => c.id === body.id);
  if (idx < 0) return [0, 0, 0];
  const n = companions.length;
  // Gaia/projected → display-scaled scene AU; else mesh-radii schematic.
  // Catalog / Facts keep the true projectedSepAu — viz-only (see schematicFit).
  const baseSep = visualBinaryDisplaySep(body, sizeMode, systemBodies);
  const fs = fitScale > 0 && Number.isFinite(fitScale) ? fitScale : 1;
  // Mesh clearance after fit: fitScale must not bury companions in the primary.
  const parent =
    systemBodies.find((b) => b.id === body.parentId) ??
    findPrimaryHost(systemBodies);
  const rPrimary = parent
    ? visualRadius(parent, sizeMode, systemBodies)
    : visualRadius(body, sizeMode, systemBodies);
  const rSelf = visualRadius(body, sizeMode, systemBodies);
  // Parent-frame kids (e.g. 55 Cnc B b/c): bump sep so apo cannot enter primary.
  const kidsFloor = visualBinaryKidsClearanceSep(body, sizeMode, systemBodies);
  // Effective helioScale already includes fit — do not multiply this floor by fs.
  const planetFloor = visualBinaryHelioPlanetClearanceSep(
    body,
    sizeMode,
    systemBodies,
    helioScale,
  );
  const sep = Math.max(
    baseSep * fs,
    rPrimary + rSelf + VISUAL_BINARY_CLEARANCE_MARGIN,
    kidsFloor,
    planetFloor,
  );
  // Even spread in the face-on orbital plane (start at 0 → +X).
  const ang = (2 * Math.PI * idx) / n;
  const x = sep * Math.cos(ang);
  const y = sep * Math.sin(ang);
  // Viz-only lift off the mean orbital plane; not a catalog inclination.
  const z = (rPrimary + rSelf) * COMPANION_OUT_OF_PLANE_FRAC;
  // ecliptic XY + small z → scene XZ / Y. No faceOn re-application.
  return eclipticToScene(x, y, z);
}


/**
 * Marker-only Explore placement for probes without usable Kepler and without
 * catalog `path.waypoints`.
 *
 * **NOT an ephemeris / NOT a trajectory.** Fail-open ring when waypoints are
 * absent. Do NOT invent Horizons samples, fake Kepler elements, or OrbitLine
 * ellipses here. When `path.waypoints` length ≥ 2, craft sits on the last
 * waypoint instead (see bodyPosition / ProbePathLine).
 *
 * Layout: shared ring outside outermost primary-frame display apo × helioScale
 * (+ mesh + margin) via {@link probeMarkerDisplaySep}; even angles among
 * marker-only probes in the face-on ecliptic plane, mapped with
 * eclipticToScene(x,y,0). Stable sort by id. Never stack on the Sun.
 */
function probeMarkerOffset(
  body: Body,
  sizeMode: SizeMode,
  systemBodies: readonly Body[],
  helioScale: number = 1,
): [number, number, number] {
  if (
    body.kind !== "probe" ||
    hasUsableOrbit(body) ||
    hasProbePathWaypoints(body)
  ) {
    return [0, 0, 0];
  }
  const probes = systemBodies
    .filter(
      (b) =>
        b.kind === "probe" &&
        !hasUsableOrbit(b) &&
        !hasProbePathWaypoints(b),
    )
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const idx = probes.findIndex((p) => p.id === body.id);
  if (idx < 0) return [0, 0, 0];
  const n = probes.length;
  const sep = probeMarkerDisplaySep(sizeMode, systemBodies, helioScale);
  if (!(sep > 0)) return [0, 0, 0];
  const ang = (2 * Math.PI * idx) / n;
  const x = sep * Math.cos(ang);
  const y = sep * Math.sin(ang);
  return eclipticToScene(x, y, 0);
}

/**
 * Explore mesh / OrbitLine visibility.
 * - Primary/root star always meshes (at origin).
 * - Companion stars (kind===star && parentId) always mesh — Kepler path when
 *   hasUsableOrbit; otherwise tight visual-binary offset (no OrbitLine).
 * - Probes (kind===probe) always mesh — path.waypoints polyline when present
 *   (never invent); else marker-only ring. No OrbitLine without Kepler.
 * - Other bodies require hasUsableOrbit.
 * - Parent-frame children: parent must be scene-visible (primary, Kepler body,
 *   OR orbit-unknown companion now visible via visual binary). Kids of
 *   visual-binary companions (e.g. 55 Cnc comp-b-b/c) track the companion
 *   offset via the existing parent-frame bodyPosition path.
 * - OrbitLine stays gated on hasUsableOrbit (no invented ellipse).
 */
function isExploreSceneBody(
  body: Body,
  primaryStarId: string | undefined,
  byId: ReadonlyMap<string, Body>,
  seen: Set<string> = new Set(),
): boolean {
  // Primary host (star | black_hole) or dedicated central (earth-sats-earth: no orbit).
  if (
    body.id === primaryStarId ||
    (isPrimaryHostKind(body.kind) && !body.parentId) ||
    (!body.parentId && !hasUsableOrbit(body))
  ) {
    return true;
  }
  // Mesh companion stars even without Kepler (visual-binary display offset).
  // Black holes are not visual-binary companions.
  if (body.kind === "star" && body.parentId) {
    return true;
  }
  // Mesh probes even without Kepler (waypoints polyline or marker-only; no OrbitLine).
  if (body.kind === "probe") {
    return true;
  }
  if (!hasUsableOrbit(body)) return false;
  if (
    (body.orbit.frame === "parent" || body.orbit.frame === "geocentric") &&
    body.parentId
  ) {
    if (seen.has(body.id)) return false;
    seen.add(body.id);
    const parent = byId.get(body.parentId);
    if (!parent) return false;
    return isExploreSceneBody(parent, primaryStarId, byId, seen);
  }
  return true;
}


/**
 * Rel scale for geocentric sats: amplify altitude vs Earth mesh so LEO rings
 * read clearly. Catalog aKm / aAu unchanged (Facts show real km).
 * See GEOCENTRIC_ALT_AMPLIFY in sizeTiers.ts.
 */
function geocentricOrbitRelScale(
  body: Body,
  sizeMode: SizeMode,
  systemBodies?: readonly Body[],
): number {
  if (body.orbit?.frame !== "geocentric" || !body.parentId) return 1;
  const parent = resolveParentBody(body, systemBodies);
  if (!parent) return 1;
  const earthVis = visualRadius(parent, sizeMode, systemBodies);
  return geocentricDisplayScale(
    body,
    earthVis > 0 ? earthVis : PLANET_VISUAL_RADIUS_SMALL,
  );
}

/**
 * Heliocentric (sun-at-origin within BarycentricRoot) scene position.
 * Parent-frame bodies (Moon) are offset by the resolved parent chain so the
 * mesh tracks a derived path around Earth — not a fake heliocentric ellipse.
 */
function bodyPosition(
  body: Body,
  simDays: number,
  distScale: number = 1,
  sizeMode: SizeMode = DEFAULT_SIZE_MODE,
  helioScale: number = 1,
  systemBodies?: readonly Body[],
  faceOn: FaceOnRotation = FACE_ON_IDENTITY,
  fitScale: number = 1,
  seen: Set<string> = new Set(),
): [number, number, number] {
  // No usable Kepler: orbit-unknown companion stars → visual-binary offset;
  // probes → last path.waypoint or marker-only ring (NOT ephemeris); else origin.
  if (!hasUsableOrbit(body)) {
    if (body.kind === "star" && body.parentId && systemBodies) {
      return visualBinaryCompanionOffset(
        body,
        sizeMode,
        systemBodies,
        fitScale,
        helioScale,
      );
    }
    if (body.kind === "probe") {
      // Honest archive waypoints: craft at last sample (heliocentric au).
      if (hasProbePathWaypoints(body)) {
        const last = body.path!.waypoints![body.path!.waypoints!.length - 1]!;
        const s =
          (distScale > 0 ? distScale : 1) * (helioScale > 0 ? helioScale : 1);
        return eclipticToSceneFaceOn(
          faceOn,
          last.xAu * s,
          last.yAu * s,
          last.zAu * s,
        );
      }
      // Fail-open marker ring when waypoints absent (NOT an ephemeris).
      if (systemBodies) {
        return probeMarkerOffset(body, sizeMode, systemBodies, helioScale);
      }
      return [0, 0, 0];
    }
    return [0, 0, 0];
  }
  if (seen.has(body.id)) return [0, 0, 0];
  seen.add(body.id);

  const s = distScale > 0 ? distScale : 1;
  const hs = helioScale > 0 ? helioScale : 1;
  if (
    (body.orbit.frame === "parent" || body.orbit.frame === "geocentric") &&
    body.parentId
  ) {
    const parent = resolveParentBody(body, systemBodies);
    if (parent) {
      const parentPos = bodyPosition(
        parent,
        simDays,
        distScale,
        sizeMode,
        helioScale,
        systemBodies,
        faceOn,
        fitScale,
        seen,
      );
      const ps =
        body.orbit.frame === "geocentric"
          ? geocentricOrbitRelScale(body, sizeMode, systemBodies)
          : parentDisplayScale(body, sizeMode, systemBodies);
      const local = localOrbitPosition(body, simDays, s * ps, faceOn);
      return [
        parentPos[0] + local[0],
        parentPos[1] + local[1],
        parentPos[2] + local[2],
      ];
    }
  }
  return localOrbitPosition(body, simDays, s * hs, faceOn);
}

/** World-space position including the applied barycentric translation. */
function bodyWorldPosition(
  body: Body,
  simDays: number,
  bary: readonly [number, number, number],
  distScale: number = 1,
  sizeMode: SizeMode = DEFAULT_SIZE_MODE,
  helioScale: number = 1,
  systemBodies?: readonly Body[],
  faceOn: FaceOnRotation = FACE_ON_IDENTITY,
  fitScale: number = 1,
): [number, number, number] {
  const [x, y, z] = bodyPosition(
    body,
    simDays,
    distScale,
    sizeMode,
    helioScale,
    systemBodies,
    faceOn,
    fitScale,
  );
  return [x + bary[0], y + bary[1], z + bary[2]];
}

/** Slow yaw for idle starfield drift (rad/s). Tiny — readable only over many seconds. */
const STARFIELD_DRIFT_RAD_PER_SEC = 0.004;

function Starfield({ count = 3200 }: { count?: number }) {
  const group = useRef<THREE.Points>(null);
  const { positions, colors } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const r = 80 + Math.random() * 320;
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
      // Subtle blue-white / warm mix
      const t = Math.random();
      if (t > 0.85) tmp.setRGB(0.95, 0.88, 0.75);
      else if (t > 0.55) tmp.setRGB(0.75, 0.82, 1);
      else tmp.setRGB(0.55, 0.62, 0.85);
      const bright = 0.55 + Math.random() * 0.45;
      col[i * 3] = tmp.r * bright;
      col[i * 3 + 1] = tmp.g * bright;
      col[i * 3 + 2] = tmp.b * bright;
    }
    return { positions: pos, colors: col };
  }, [count]);

  const posAttr = useMemo(
    () => new THREE.BufferAttribute(positions, 3),
    [positions],
  );
  const colAttr = useMemo(
    () => new THREE.BufferAttribute(colors, 3),
    [colors],
  );

  // Subtle drift while SimDriver keeps demand frames flowing; skip when tab hidden.
  useFrame((_, delta) => {
    if (typeof document !== "undefined" && document.hidden) return;
    if (!group.current) return;
    group.current.rotation.y += STARFIELD_DRIFT_RAD_PER_SEC * Math.min(delta, 0.25);
  });

  return (
    <points ref={group} frustumCulled={false}>
      <bufferGeometry>
        <primitive attach="attributes-position" object={posAttr} />
        <primitive attach="attributes-color" object={colAttr} />
      </bufferGeometry>
      <pointsMaterial
        size={0.09}
        sizeAttenuation
        vertexColors
        transparent
        opacity={0.9}
        depthWrite={false}
      />
    </points>
  );
}

/** Soft radial haze behind the system (cheap additive sphere). */
function SoftHaze() {
  return (
    <mesh>
      <sphereGeometry args={[120, 24, 16]} />
      <meshBasicMaterial
        color="#1a2a4a"
        transparent
        opacity={0.12}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  );
}

const ORBIT_LINE_SAMPLES = 192;


/** True when orbit/path lines for this body kind should be suppressed. Moons inherit planet. */
function orbitPathsHiddenFor(
  kind: BodyKind,
  hideOrbitPathKinds?: ReadonlySet<BodyKind>,
): boolean {
  if (!hideOrbitPathKinds || hideOrbitPathKinds.size === 0) return false;
  if (hideOrbitPathKinds.has(kind)) return true;
  if (kind === "moon" && hideOrbitPathKinds.has("planet")) return true;
  return false;
}

const OrbitLine = memo(function OrbitLine({
  body,
  highlighted,
  highlightColor,
}: {
  body: Body;
  highlighted: boolean;
  highlightColor?: string;
}) {
  const group = useRef<THREE.Group>(null);
  const sizeMode = useSizeMode();
  const distScale = orbitDistanceScale(sizeMode);
  const { bodies: systemBodies, helioScale, fitScale, faceOn } = useSystemViz();
  const { getSimDays } = useSimApi();
  const parent =
    (body.orbit?.frame === "parent" || body.orbit?.frame === "geocentric") &&
    body.parentId
      ? resolveParentBody(body, systemBodies)
      : undefined;
  const relScale = useMemo(() => {
    if (!hasUsableOrbit(body)) return distScale;
    if (parent && body.orbit?.frame === "geocentric") {
      return distScale * geocentricOrbitRelScale(body, sizeMode, systemBodies);
    }
    if (parent) return distScale * parentDisplayScale(body, sizeMode, systemBodies);
    return distScale * helioScale;
  }, [body, parent, distScale, sizeMode, helioScale, systemBodies]);

  const points = useMemo(() => {
    if (!hasUsableOrbit(body)) return null;
    // True-anomaly sampling (see sampleOrbit) keeps eccentric bodies on the polyline.
    return sampleOrbit(body.orbit, ORBIT_LINE_SAMPLES).map(([x, y, z]) => {
      const [sx, sy, sz] = eclipticToSceneFaceOn(
        faceOn,
        x * relScale,
        y * relScale,
        z * relScale,
      );
      return new THREE.Vector3(sx, sy, sz);
    });
  }, [body.orbit, relScale, faceOn]);

  const syncParent = (days: number) => {
    if (!parent || !group.current) return;
    const [x, y, z] = bodyPosition(
      parent,
      days,
      distScale,
      sizeMode,
      helioScale,
      systemBodies,
      faceOn,
      fitScale,
    );
    group.current.position.set(x, y, z);
  };

  useLayoutEffect(() => {
    syncParent(getSimDays());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- parent pose sync
  }, [parent, distScale, sizeMode, helioScale, fitScale, faceOn]);

  useFrame(() => {
    syncParent(getSimDays());
  });

  if (!points) return null;
  const base = body.color ?? "#666";
  const color = highlighted ? (highlightColor ?? base) : base;
  const line = (
    <Line
      points={points}
      color={color}
      lineWidth={highlighted ? 2.2 : 1}
      transparent
      opacity={highlighted ? 0.85 : 0.4}
    />
  );
  // Parent-frame: line lives in a group that tracks the parent mesh.
  if (parent) {
    return (
      <group ref={group} name={`orbit-${body.id}`}>
        {line}
      </group>
    );
  }
  return line;
});

/**
 * Honest probe trajectory polyline from catalog `path.waypoints` (≥2).
 * Heliocentric ecliptic au → scene via faceOn × distScale × helioScale.
 * Never invents points — returns null when waypoints are absent.
 */
const ProbePathLine = memo(function ProbePathLine({
  body,
  highlighted,
  highlightColor,
}: {
  body: Body;
  highlighted: boolean;
  highlightColor?: string;
}) {
  const sizeMode = useSizeMode();
  const distScale = orbitDistanceScale(sizeMode);
  const { helioScale, faceOn } = useSystemViz();

  const points = useMemo(() => {
    const wps = body.path?.waypoints;
    if (!wps || wps.length < 2) return null;
    const s =
      (distScale > 0 ? distScale : 1) * (helioScale > 0 ? helioScale : 1);
    return wps.map((wp) => {
      const [sx, sy, sz] = eclipticToSceneFaceOn(
        faceOn,
        wp.xAu * s,
        wp.yAu * s,
        wp.zAu * s,
      );
      return new THREE.Vector3(sx, sy, sz);
    });
  }, [body.path?.waypoints, distScale, helioScale, faceOn]);

  if (!points) return null;
  const base = body.color ?? "#888";
  const color = highlighted ? (highlightColor ?? base) : base;
  return (
    <Line
      points={points}
      color={color}
      lineWidth={highlighted ? 2 : 1.1}
      transparent
      opacity={highlighted ? 0.8 : 0.45}
    />
  );
});

/**
 * Probe craft mesh (procedural, no texture packs).
 * Full (focused/near): bus box + HGA dish + boom/antenna.
 * Far/simple: small box. Shared materials via getSatSharedMaterial.
 * frustumCulled true; body.color tint; same click/contextMenu as BodyMesh.
 */
const ProbeBodyMesh = memo(function ProbeBodyMesh({
  body,
  focused,
  groupRef,
  spinRef,
  r,
  onClick,
  onContextMenu,
}: {
  body: Body;
  focused: boolean;
  groupRef: RefObject<THREE.Group | null>;
  spinRef: RefObject<THREE.Object3D | null>;
  r: number;
  onClick: (e: { stopPropagation: () => void }) => void;
  onContextMenu: (e: {
    stopPropagation: () => void;
    nativeEvent?: { preventDefault?: () => void };
  }) => void;
}) {
  const tint = body.color ?? "#c8c8c8";
  const busMat = getSatSharedMaterial("bus", tint);
  const dishMat = getSatSharedMaterial("antenna", "#e8e8e8");
  const boomMat = getSatSharedMaterial("antenna", "#bbbbbb");
  const tierRef = useRef<"full" | "simple">(focused ? "full" : "simple");
  const fullRef = useRef<THREE.Group>(null);
  const simpleRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();

  const applyTier = (tier: "full" | "simple") => {
    tierRef.current = tier;
    if (fullRef.current) fullRef.current.visible = tier === "full";
    if (simpleRef.current) simpleRef.current.visible = tier === "simple";
  };

  useLayoutEffect(() => {
    applyTier(focused ? "full" : "simple");
  }, [focused]);

  useFrame(() => {
    if (!groupRef.current) return;
    const dist = camera.position.distanceTo(groupRef.current.position);
    const next: "full" | "simple" =
      focused || !(dist > SAT_LOD_NEAR_DIST) ? "full" : "simple";
    if (next !== tierRef.current) applyTier(next);
  });

  const s = focused ? 1.35 : 1;
  return (
    <group ref={groupRef} name={body.id}>
      <group
        ref={spinRef}
        scale={s}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        {/* Focused / near: bus + HGA dish + boom/antenna. */}
        <group ref={fullRef} visible={focused}>
          <mesh frustumCulled material={busMat}>
            <boxGeometry args={[r * 1.3, r * 0.75, r * 0.95]} />
          </mesh>
          {/* HGA: thin dish (flattened sphere). */}
          <mesh
            frustumCulled
            position={[0, 0, r * 0.78]}
            scale={[1, 1, 0.18]}
            material={dishMat}
          >
            <sphereGeometry args={[r * 0.9, 16, 12]} />
          </mesh>
          {/* Boom / antenna mast. */}
          <mesh
            frustumCulled
            position={[0, r * 0.95, 0]}
            material={boomMat}
          >
            <boxGeometry args={[r * 0.12, r * 1.35, r * 0.12]} />
          </mesh>
          <mesh
            frustumCulled
            position={[0, r * 1.7, 0]}
            material={dishMat}
          >
            <boxGeometry args={[r * 0.35, r * 0.12, r * 0.35]} />
          </mesh>
        </group>
        {/* Far / idle: single small box. */}
        <mesh
          ref={simpleRef}
          frustumCulled
          visible={!focused}
          material={busMat}
        >
          <boxGeometry args={[r * 1.15, r * 1.15, r * 1.15]} />
        </mesh>
      </group>
    </group>
  );
});

/**
 * Artificial satellite mesh with focus/distance/density LOD.
 * Shared materials via getSatSharedMaterial — no per-mount MeshStandardMaterial.
 * frustumCulled stays true on mesh / points impostors.
 */
const SatelliteBodyMesh = memo(function SatelliteBodyMesh({
  body,
  focused,
  groupRef,
  spinRef,
  r,
  onClick,
  onContextMenu,
  satLod,
}: {
  body: Body;
  focused: boolean;
  groupRef: RefObject<THREE.Group | null>;
  spinRef: RefObject<THREE.Object3D | null>;
  r: number;
  onClick: (e: { stopPropagation: () => void }) => void;
  onContextMenu: (e: {
    stopPropagation: () => void;
    nativeEvent?: { preventDefault?: () => void };
  }) => void;
  satLod?: { satCount: number; meshRank: number };
}) {
  const tint = body.color ?? "#c8c8c8";
  const busMat = getSatSharedMaterial("bus", tint);
  const panelMat = getSatSharedMaterial("panel", "#3a5a8a");
  const antennaMat = getSatSharedMaterial("antenna", "#dddddd");
  const pointMat = getSatPointsMaterial(tint);
  const tierRef = useRef<SatLodTier>(focused ? "full" : "simple");
  const fullRef = useRef<THREE.Group>(null);
  const simpleRef = useRef<THREE.Mesh>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const { camera } = useThree();

  const applyTier = (tier: SatLodTier) => {
    tierRef.current = tier;
    if (fullRef.current) fullRef.current.visible = tier === "full";
    if (simpleRef.current) simpleRef.current.visible = tier === "simple";
    if (pointsRef.current) pointsRef.current.visible = tier === "points";
  };

  useLayoutEffect(() => {
    applyTier(focused ? "full" : "simple");
  }, [focused]);

  useFrame(() => {
    if (!groupRef.current) return;
    const dist = camera.position.distanceTo(groupRef.current.position);
    const next = resolveSatLodTier({
      focused,
      satCount: satLod?.satCount ?? 1,
      meshRank: satLod?.meshRank ?? 0,
      distToCamera: dist,
    });
    if (next !== tierRef.current) applyTier(next);
  });

  const s = focused ? 1.35 : 1;
  return (
    <group ref={groupRef} name={body.id}>
      <group
        ref={spinRef}
        scale={s}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        {/* Focused / near: full procedural bus + panels + antenna. */}
        <group ref={fullRef} visible={focused}>
          <mesh frustumCulled material={busMat}>
            <boxGeometry args={[r * 1.4, r * 0.7, r * 0.9]} />
          </mesh>
          <mesh frustumCulled material={panelMat}>
            <boxGeometry args={[r * 2.6, r * 0.08, r * 1.1]} />
          </mesh>
          <mesh frustumCulled position={[0, r * 0.55, 0]} material={antennaMat}>
            <boxGeometry args={[r * 0.35, r * 0.55, r * 0.35]} />
          </mesh>
        </group>
        {/* Near/idle among visible set: simplified octahedron. */}
        <mesh
          ref={simpleRef}
          frustumCulled
          visible={!focused}
          material={busMat}
        >
          <octahedronGeometry args={[r * 1.15, 0]} />
        </mesh>
        {/* Far / dense: tiny Points impostor. */}
        <points ref={pointsRef} frustumCulled visible={false}>
          <bufferGeometry>
            <primitive
              attach="attributes-position"
              object={SAT_POINT_POSITION_ATTR}
            />
          </bufferGeometry>
          <primitive object={pointMat} attach="material" />
        </points>
      </group>
    </group>
  );
});

const BodyMesh = memo(function BodyMesh({
  body,
  focused,
  onSelect,
  highlightColor,
  selectedPoiId,
  onSelectPoi,
  satLod,
  hideOrbitPathKinds,
  hideProbeMeshes = false,
}: {
  body: Body;
  focused: boolean;
  onSelect?: (id: string | null) => void;
  highlightColor?: string;
  selectedPoiId?: string | null;
  onSelectPoi?: (id: string | null) => void;
  /** Satellite mesh LOD inputs (omit for non-sats). */
  satLod?: { satCount: number; meshRank: number };
  hideOrbitPathKinds?: ReadonlySet<BodyKind>;
  hideProbeMeshes?: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const { getSimDays } = useSimApi();
  const { bodies: systemBodies, helioScale, fitScale, faceOn, primaryStarId } = useSystemViz();
  const sizeMode = useSizeMode();
  const distScale = orbitDistanceScale(sizeMode);
  const r = visualRadius(body, sizeMode, systemBodies);
  // Marquee maps: lazy-load when focused or body is in-scene (near); fail-open.
  const textureId = body.appearance?.textureId;
  const surfaceMap = useRegistryTexture(textureId, Boolean(textureId));
  const mat = getBodyAppearanceMaterial(
    body,
    focused,
    highlightColor,
    surfaceMap,
  );
  const surfacePois = focused ? getPoisForBody(body.id) : [];

  const handleClick = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      // Second click on the focused body clears (William deselect).
      onSelect?.(focused ? null : body.id);
    },
    [body.id, focused, onSelect],
  );

  const handleContextMenu = useCallback(
    (e: { stopPropagation: () => void; nativeEvent?: { preventDefault?: () => void } }) => {
      e.stopPropagation();
      e.nativeEvent?.preventDefault?.();
      onSelect?.(null);
    },
    [onSelect],
  );

  const spinMesh = useRef<THREE.Object3D>(null);

  const applyPose = (days: number) => {
    if (!group.current) return;
    const [x, y, z] = bodyPosition(
      body,
      days,
      distScale,
      sizeMode,
      helioScale,
      systemBodies,
      faceOn,
      fitScale,
    );
    group.current.position.set(x, y, z);
    const period = body.facts.rotationPeriodD;
    if (spinMesh.current && period != null && period !== 0) {
      spinMesh.current.rotation.y = (days / period) * Math.PI * 2;
    }
  };

  // Epoch pose before first painted frame (demand mode may not have run useFrame yet).
  useLayoutEffect(() => {
    applyPose(getSimDays());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / body identity only
  }, [body]);

  // Shared sim clock drives orbital MA whenever Explore is animating (idle or follow).
  useFrame(() => {
    applyPose(getSimDays());
  });

  if (body.kind === "star") {
    // Primary: full light. Kepler companions move on orbit; orbit-unknown
    // companions sit on visual-binary offset — both use dim light (soft perf).
    const isPrimaryStar = body.id === primaryStarId;
    const lightIntensity = isPrimaryStar ? 2.2 : 0.8;
    const lightDistance = isPrimaryStar ? 80 : 40;
    return (
      <group ref={group} name={body.id}>
        {/* Primary: origin. Kepler companion: orbit+OrbitLine. Orbit-unknown: visual-binary offset (no OrbitLine). */}
        <pointLight
          intensity={lightIntensity}
          distance={lightDistance}
          color={body.color ?? "#FDB813"}
        />
        <mesh
          ref={spinMesh}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          material={mat}
          scale={focused ? 1.2 : 1}
        >
          <sphereGeometry args={[r, 32, 32]} />
        </mesh>
      </group>
    );
  }

  // Artificial satellites: procedural LOD (no real sat texture packs).
  // Focused → full box+panels; near/idle → simple octahedron; far/dense → Points.
  if (body.kind === "satellite") {
    return (
      <SatelliteBodyMesh
        body={body}
        focused={focused}
        groupRef={group}
        spinRef={spinMesh}
        r={r}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        satLod={satLod}
      />
    );
  }

  if (body.kind === "black_hole") {
    // Primary BH host: dark sphere + thin equatorial accretion torus +
    // color-keyed pointLight (no OrbitLine; no extra glow shells).
    const bhColor = body.color ?? "#ff6a3d";
    const ringRadius = r * 1.48;
    const ringTube = Math.max(r * 0.028, 0.002);
    return (
      <group ref={group} name={body.id}>
        <pointLight intensity={1.75} distance={70} color={bhColor} />
        <group
          ref={spinMesh}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          scale={focused ? 1.2 : 1}
        >
          <mesh material={mat}>
            <sphereGeometry args={[r, 32, 32]} />
          </mesh>
          {/* Thin emissive torus coplanar with equator — edge-on silhouette. */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[ringRadius, ringTube, 8, 64]} />
            <meshStandardMaterial
              color={bhColor}
              emissive={bhColor}
              emissiveIntensity={focused ? 0.9 : 0.5}
              roughness={0.4}
              metalness={0.15}
              toneMapped
            />
          </mesh>
        </group>
      </group>
    );
  }

  // Probe: procedural craft (ProbeBodyMesh) + optional path.waypoints Line.
  // Same click / contextMenu deselect contract. No OrbitLine without Kepler.
  // hideOrbitPathKinds / hideProbeMeshes are independent (paths vs craft).
  if (body.kind === "probe") {
    if (hideProbeMeshes && orbitPathsHiddenFor(body.kind, hideOrbitPathKinds)) return null;
    return (
      <>
        {!hideProbeMeshes ? (
          <ProbeBodyMesh
            body={body}
            focused={focused}
            groupRef={group}
            spinRef={spinMesh}
            r={r}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
          />
        ) : null}
        {!orbitPathsHiddenFor(body.kind, hideOrbitPathKinds) ? (
          <ProbePathLine
            body={body}
            highlighted={focused}
            highlightColor={highlightColor}
          />
        ) : null}
      </>
    );
  }

  return (
    <group ref={group} name={body.id}>
      <mesh
        ref={spinMesh}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        material={mat}
        scale={focused ? 1.35 : 1}
      >
        <sphereGeometry args={[r, 24, 24]} />
        {surfacePois.length > 0 ? (
          <SurfacePoiMarkers
            pois={surfacePois}
            radius={r}
            selectedPoiId={selectedPoiId}
            onSelectPoi={onSelectPoi}
          />
        ) : null}
      </mesh>
    </group>
  );
});

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Normalize angle delta into (-π, π]. */
function wrapDeltaAngle(d: number): number {
  if (d > Math.PI) return d - Math.PI * 2;
  if (d <= -Math.PI) return d + Math.PI * 2;
  return d;
}

/**
 * Focused mesh scale (BodyMesh). Framing uses the on-screen sphere, so include
 * this when computing FOV distance — matches Pluto gold-standard screenshot.
 */
function focusMeshScale(body: Body): number {
  return isPrimaryHostKind(body.kind) ? 1.2 : 1.35;
}

/**
 * FOV framing must not use microscopic True/Prop radii or the camera sits
 * near the near plane and the mesh vanishes (Pluto → black void). Floor the
 * *framing* radius only — catalog/visualRadius formulas stay locked.
 */
const FOCUS_FRAMING_RADIUS_MIN = 0.03;

function focusFramingRadius(
  body: Body,
  sizeMode: SizeMode,
  systemBodies?: readonly Body[],
): number {
  const r = visualRadius(body, sizeMode, systemBodies) * focusMeshScale(body);
  return Math.max(r, FOCUS_FRAMING_RADIUS_MIN);
}

/**
 * Target on-screen diameter as a fraction of min(Explore viewport w, h).
 * Pluto gold standard ≈25–30%; prior sin/height framing read ~10% on screen,
 * so FOCUS_FILL is raised (0.48) with tan + min(w,h) so framed bodies land
 * in that band for sun / planets / dwarf planets / asteroids.
 */
const FOCUS_FILL = 0.48;

/**
 * OrbitControls dolly floor. Idle keeps Explore True floor (~0.23 from
 * closer-True UX). While focused, allow tighter than idle for tiny True-scale
 * bodies, but never below ~2.2× focused mesh radius or inside the near plane
 * (Math.min(idle, tight) previously let large True-sun dolly inside the mesh).
 */
function orbitMinDistance(
  sizeMode: SizeMode,
  focusBody?: Body | null,
  cameraNear: number = CAMERA_NEAR,
  systemBodies?: readonly Body[],
): number {
  const idle = sizeMode === "true" ? 0.23 : 0.4;
  if (!focusBody) return idle;
  const rMesh =
    visualRadius(focusBody, sizeMode, systemBodies) * focusMeshScale(focusBody);
  const r = Math.max(rMesh, FOCUS_FRAMING_RADIUS_MIN);
  const near = cameraNear > 0 ? cameraNear : CAMERA_NEAR;
  // Keep outside real mesh, and never so close tiny True/Prop bodies vanish.
  return Math.max(rMesh * 2.2, r * 1.15, near + rMesh, 0.05);
}

/** Auto-frame floor — tracks orbitMinDistance so focus snap can use the dolly. */
function focusDistanceFloor(
  sizeMode: SizeMode,
  focusBody?: Body | null,
  cameraNear: number = CAMERA_NEAR,
  systemBodies?: readonly Body[],
): number {
  if (focusBody) {
    const rMesh =
      visualRadius(focusBody, sizeMode, systemBodies) * focusMeshScale(focusBody);
    const r = Math.max(rMesh, FOCUS_FRAMING_RADIUS_MIN);
    const near = cameraNear > 0 ? cameraNear : CAMERA_NEAR;
    // Outside real mesh; framing floor keeps Tiny True/Prop bodies visible.
    return Math.max(rMesh * 2.5, r * 1.2, near + rMesh, 0.06);
  }
  return sizeMode === "true" ? 0.2 : 0.36;
}

/**
 * FOV-based focus distance for ALL bodies (sun + planets + asteroids).
 * On-screen diameter ≈ fill * min(viewport width, height):
 *   d = r / (fill * tan(fovY/2) * min(1, aspect))
 * Replaces sin-based height-only framing that undershot William's Pluto ref.
 * Always enforces dist >= focused mesh radius × 2.5 and near+r so True/Prop
 * focus never ends inside the sphere (tiny meshes used to frame below near).
 */
function focusFrameDistance(
  body: Body,
  fovYDeg: number,
  aspect: number = 1,
  fill: number = FOCUS_FILL,
  sizeMode: SizeMode = DEFAULT_SIZE_MODE,
  cameraNear: number = CAMERA_NEAR,
  systemBodies?: readonly Body[],
): number {
  const r = focusFramingRadius(body, sizeMode, systemBodies);
  const halfRad = ((fovYDeg * Math.PI) / 180) / 2;
  const tanHalf = Math.tan(halfRad);
  if (!(tanHalf > 1e-6) || !(fill > 1e-6)) return 12;
  // PerspectiveCamera fov is vertical; half-extent for min(w,h). Prefer the
  // smaller of vertical/horizontal so a skewed visibleAspect (viewOffset /
  // portrait) cannot enlarge halfMin and pull the camera inside the mesh.
  const a = Number.isFinite(aspect) && aspect > 1e-6 ? aspect : 1;
  const halfMin = Math.min(tanHalf, tanHalf * a);
  const framed = r / (fill * halfMin);
  return Math.max(
    focusDistanceFloor(sizeMode, body, cameraNear, systemBodies),
    framed,
  );
}

/** Aspect of the *visible* sub-rect when setViewOffset is active. */
function visibleAspect(camera: THREE.PerspectiveCamera): number {
  const v = camera.view;
  if (v?.enabled && v.height > 1e-6) return v.width / v.height;
  return camera.aspect > 1e-6 ? camera.aspect : 1;
}

/**
 * Shift PerspectiveCamera projection center into the visible gap between
 * Explore overlays (Facts on the right; BodyRail is outside the canvas).
 * Clears on unmount / when insets are zero.
 */
function ViewOffsetController({
  insetLeft = 0,
  insetRight = 0,
}: {
  insetLeft?: number;
  insetRight?: number;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);

  useLayoutEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const fullW = Math.max(1, size.width);
    const fullH = Math.max(1, size.height);
    const L = Math.max(0, Math.min(insetLeft, fullW - 1));
    const R = Math.max(0, Math.min(insetRight, fullW - L - 1));

    // Insets cover the canvas (Facts on the right). Cropping to the visible
    // sub-rect with x=L made optical center LEFT of mid → body appeared RIGHT.
    // Shift full-frame film by (L-R)/2 so optical center matches the visible gap.
    if (L <= 0 && R <= 0) {
      camera.clearViewOffset();
    } else {
      camera.setViewOffset(fullW, fullH, (L - R) / 2, 0, fullW, fullH);
    }
    camera.updateProjectionMatrix();
    invalidate();

    return () => {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    };
  }, [camera, size.width, size.height, insetLeft, insetRight, invalidate]);

  return null;
}


/**
 * One-shot idle pose from system extent. Runs before FollowCamera layout so a
 * null-focus freeze snapshots the extent-framed distance (not the Canvas
 * legacy fallback). Deep-link focus leaves pose to FollowCamera.
 */
function IdleCameraBootstrap({
  focusId,
  hideProbeMeshes = false,
}: {
  focusId?: string | null;
  /** When craft meshes are hidden, ignore probe marker ring extent (fail-open). */
  hideProbeMeshes?: boolean;
}) {
  const { bodies: systemBodies, helioScale, fitScale } = useSystemViz();
  const sizeMode = useSizeMode();
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const invalidate = useThree((s) => s.invalidate);
  const applied = useRef(false);

  useLayoutEffect(() => {
    if (applied.current) return;
    applied.current = true;
    if (focusId) return; // FollowCamera focus snap owns pose

    // Planet apo×helio (already fit-scaled) + companion display seps × fitScale
    // + helio-planet clearance (already in effective helioScale units).
    const geoSats = systemBodies.filter(
      (b) => b.orbit?.frame === "geocentric" && hasUsableOrbit(b),
    );
    let extent: number;
    let starVis: number;
    if (geoSats.length > 0) {
      // Earth-centered Explore: frame on amplified LEO rings, not tiny aAu.
      const earth =
        systemBodies.find((b) => !b.parentId && !b.orbit) ??
        systemBodies.find((b) => b.kind === "planet" && !b.parentId);
      const earthVis = earth
        ? visualRadius(earth, sizeMode, systemBodies)
        : PLANET_VISUAL_RADIUS_SMALL;
      starVis = earthVis;
      extent = earthVis;
      for (const b of geoSats) {
        const rel = geocentricOrbitRelScale(b, sizeMode, systemBodies);
        const apo = b.orbit!.aAu * (1 + b.orbit!.e) * rel;
        if (apo > extent) extent = apo;
      }
      extent *= 1.25;
    } else {
      extent = Math.max(
        systemSceneExtent(systemBodies, helioScale),
        maxCompanionDisplaySep(systemBodies, sizeMode) * fitScale,
        // Marker-only probe ring (NOT ephemeris) — keep idle frame outside placeholders.
        // Skip when probe meshes are hidden (would inflate framing for invisible markers).
        hideProbeMeshes
          ? 0
          : probeMarkerDisplaySep(sizeMode, systemBodies, helioScale),
      );
      for (const b of systemBodies) {
        if (b.kind !== "star" || !b.parentId || hasUsableOrbit(b)) continue;
        const clear = visualBinaryHelioPlanetClearanceSep(
          b,
          sizeMode,
          systemBodies,
          helioScale,
        );
        if (clear > extent) extent = clear;
      }
      const star = findPrimaryHost(systemBodies);
      starVis = star ? visualRadius(star, sizeMode, systemBodies) : 0;
    }
    const dist = schematicIdleCameraDistance(extent, starVis, fitScale);
    const [ox, oy, oz] = IDLE_CAMERA_OFFSET;
    const len = Math.hypot(ox, oy, oz) || 1;
    camera.position.set((ox / len) * dist, (oy / len) * dist, (oz / len) * dist);
    camera.lookAt(0, 0, 0);
    if (controls?.target) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
    invalidate();
  }, [camera, controls, invalidate, focusId, systemBodies, helioScale, fitScale, sizeMode, hideProbeMeshes]);

  return null;
}

/**
 * FollowCamera: slides look-at with the body, rides along by yawing the
 * camera offset with orbital bearing change, and never overwrites distance —
 * user OrbitControls dolly/orbit/pan still win on offset length/direction.
 *
 * Freeze contract (unfocus): after clearing focus, with no user input,
 * camera.position and controls.target stay bit-identical (≤1e-6) for 2+s.
 * Paths that must not move the pose on clear:
 * - no follow lerp / bearing yaw / target retarget / damping
 * - OrbitControls enableDamping=false, autoRotate=false
 * - BarycentricRoot freezes its translation while not following an orbiter
 *   (idle / sun focus) so the world does not slide under a world-fixed
 *   camera (apparent pan on clear)
 * - Hard pose snapshot on focus→null / follow→idle; idle useFrame never
 *   writes camera/target (kills one-extra-frame lerp)
 * - Starfield yaw is local to the points mesh only (does not move camera)
 * - Explore FactsPanel is a canvas overlay (page) so unfocus does not resize
 *   the WebGL viewport (layout shift looked like a left pan)
 * Idle OrbitControls still work — we do not overwrite pose every idle frame.
 *
 * Size-mode contract: do NOT snap azimuth/elevation back to the focus pose.
 * When Schematic/Prop/True changes mesh + helio display scale, multiply the
 * current camera offset length (and idle look-at from origin) by the ratio of
 * old→new framing metric — focusFrameDistance while focused, else helioScale.
 */
function FollowCamera() {
  const sizeMode = useSizeMode();
  const distScale = orbitDistanceScale(sizeMode);
  const { bodies: systemBodies, helioScale, fitScale, faceOn } = useSystemViz();
  const { getSimDays, getFollowing, getFocusId, getBaryOffset } = useSimApi();
  const focusId = getFocusId();
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const invalidate = useThree((s) => s.invalidate);
  const target = useRef(new THREE.Vector3(0, 0, 0));
  const desired = useRef(new THREE.Vector3(0, 0, 0));
  const offset = useRef(new THREE.Vector3());
  const lastBearing = useRef<number | null>(null);
  /** Edge-detect follow→idle so we hard-freeze pose and kill residual motion. */
  const wasFollowing = useRef(false);
  /**
   * Once set (focus cleared / follow stopped), useFrame must not write pose.
   * Cleared only on focus acquire snap.
   */
  const poseFrozen = useRef(false);
  /**
   * Baseline for proportional size-mode camera scale. Updated after focus snap
   * / freeze and after each size-mode adjust — never used to hard-reset pose.
   */
  const sizeModeFrameRef = useRef<{
    sizeMode: SizeMode;
    helioScale: number;
    metric: number;
    ready: boolean;
  }>({ sizeMode, helioScale, metric: 0, ready: false });

  const framingMetricFor = (body: Body | null | undefined): number => {
    if (body) {
      const fovY =
        camera instanceof THREE.PerspectiveCamera ? camera.fov : 45;
      const aspect =
        camera instanceof THREE.PerspectiveCamera
          ? visibleAspect(camera)
          : 1;
      const near =
        camera instanceof THREE.PerspectiveCamera ? camera.near : CAMERA_NEAR;
      return focusFrameDistance(
        body,
        fovY,
        aspect,
        FOCUS_FILL,
        sizeMode,
        near,
        systemBodies,
      );
    }
    return Math.max(helioScale, 1e-9);
  };

  const rememberSizeModeFrame = (metric: number) => {
    sizeModeFrameRef.current = {
      sizeMode,
      helioScale,
      metric: Math.max(metric, 1e-9),
      ready: true,
    };
  };

  /** Snapshot live camera + controls into follow refs without moving either. */
  const freezePoseRefs = () => {
    lastBearing.current = null;
    if (controls?.target) {
      target.current.copy(controls.target);
      desired.current.copy(controls.target);
      offset.current.copy(camera.position).sub(controls.target);
    } else {
      desired.current.copy(target.current);
      offset.current.copy(camera.position).sub(target.current);
    }
    poseFrozen.current = true;
    // One update() with damping off clears sphericalDelta / panOffset so the
    // next drei useFrame controls.update() is a true no-op on the pose.
    if (controls) controls.update();
  };

  // Snap / re-frame only when acquiring a focus. Clearing focus must leave
  // camera position + OrbitControls target/zoom exactly as last follow frame.
  useLayoutEffect(() => {
    if (!focusId) {
      wasFollowing.current = false;
      freezePoseRefs();
      rememberSizeModeFrame(framingMetricFor(null));
      return;
    }
    const b = getBody(focusId ?? "");
    if (!b) {
      wasFollowing.current = false;
      freezePoseRefs();
      rememberSizeModeFrame(framingMetricFor(null));
      return;
    }
    poseFrozen.current = false;
    const days = getSimDays();
    const helio = bodyPosition(
      b,
      days,
      distScale,
      sizeMode,
      helioScale,
      systemBodies,
      faceOn,
      fitScale,
    );
    const pos = bodyWorldPosition(
      b,
      days,
      getBaryOffset(),
      distScale,
      sizeMode,
      helioScale,
      systemBodies,
      faceOn,
      fitScale,
    );
    const fovY =
      camera instanceof THREE.PerspectiveCamera ? camera.fov : 45;
    const aspect =
      camera instanceof THREE.PerspectiveCamera
        ? visibleAspect(camera)
        : 1;
    const near =
      camera instanceof THREE.PerspectiveCamera ? camera.near : CAMERA_NEAR;
    const dist = focusFrameDistance(
      b,
      fovY,
      aspect,
      FOCUS_FILL,
      sizeMode,
      near,
      systemBodies,
    );
    target.current.set(pos[0], pos[1], pos[2]);
    desired.current.copy(target.current);
    // Pleasant elevation/azimuth at EXACT framing distance (fill is distance).
    offset.current.set(0.55, 0.42, 0.72).normalize().multiplyScalar(dist);
    camera.position.copy(target.current).add(offset.current);
    camera.lookAt(target.current);
    if (controls?.target) {
      controls.target.copy(target.current);
      controls.update();
    }
    lastBearing.current = focusIsOrbiter(focusId)
      ? Math.atan2(helio[0], helio[2])
      : null;
    wasFollowing.current = focusIsOrbiter(focusId);
    rememberSizeModeFrame(dist);
    invalidate();
  }, [focusId, camera, controls, invalidate]); // eslint-disable-line react-hooks/exhaustive-deps -- snap on focus acquire only; size mode uses proportional scale effect below

  // Size mode: scale distance/offset by framing-metric ratio; keep look direction.
  useLayoutEffect(() => {
    const prev = sizeModeFrameRef.current;
    const focusNow = getFocusId();
    const body = focusNow ? getBody(focusNow) : null;
    const nextMetric = framingMetricFor(body);

    if (!prev.ready) {
      rememberSizeModeFrame(nextMetric);
      return;
    }
    if (prev.sizeMode === sizeMode) {
      // Focus snap/clear owns pose; keep baseline metric in sync only.
      rememberSizeModeFrame(nextMetric);
      return;
    }

    const ratio =
      prev.metric > 0 && Number.isFinite(nextMetric)
        ? nextMetric / prev.metric
        : 1;
    const helioRatio =
      prev.helioScale > 0 && Number.isFinite(helioScale)
        ? helioScale / prev.helioScale
        : 1;

    if (controls?.target) {
      offset.current.copy(camera.position).sub(controls.target);
      target.current.copy(controls.target);
    } else {
      offset.current.copy(camera.position).sub(target.current);
    }

    if (body) {
      const pos = bodyWorldPosition(
        body,
        getSimDays(),
        getBaryOffset(),
        distScale,
        sizeMode,
        helioScale,
        systemBodies,
        faceOn,
        fitScale,
      );
      target.current.set(pos[0], pos[1], pos[2]);
      desired.current.copy(target.current);
    } else if (
      Number.isFinite(helioRatio) &&
      helioRatio > 0 &&
      Math.abs(helioRatio - 1) > 1e-9
    ) {
      // Idle: system display scale changed — scale look-at from origin with orbits.
      target.current.multiplyScalar(helioRatio);
      desired.current.copy(target.current);
    } else {
      desired.current.copy(target.current);
    }

    const len = offset.current.length();
    if (len > 1e-9 && Number.isFinite(ratio) && ratio > 0) {
      const near =
        camera instanceof THREE.PerspectiveCamera ? camera.near : CAMERA_NEAR;
      const minD = orbitMinDistance(sizeMode, body, near, systemBodies);
      const nextLen = Math.max(len * ratio, minD);
      offset.current.multiplyScalar(nextLen / len);
    }

    camera.position.copy(target.current).add(offset.current);
    if (controls?.target) {
      controls.target.copy(target.current);
      controls.update();
    } else {
      camera.lookAt(target.current);
    }
    rememberSizeModeFrame(nextMetric);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- proportional size-mode scale only; focus snap is separate
  }, [sizeMode, helioScale, camera, controls, invalidate]);

  useFrame((_, delta) => {
    const followingNow = getFollowing();
    const focusNow = getFocusId();

    // Hard freeze: after unfocus / follow stop, never touch camera or target.
    if (poseFrozen.current || !followingNow || !focusNow) {
      if (wasFollowing.current) {
        wasFollowing.current = false;
        freezePoseRefs();
      }
      return;
    }

    const b = getBody(focusNow ?? "");
    if (!b?.orbit) {
      if (wasFollowing.current) {
        wasFollowing.current = false;
        freezePoseRefs();
      }
      return;
    }

    wasFollowing.current = true;
    poseFrozen.current = false;

    const days = getSimDays();
    const helio = bodyPosition(
      b,
      days,
      distScale,
      sizeMode,
      helioScale,
      systemBodies,
      faceOn,
      fitScale,
    );
    const pos = bodyWorldPosition(
      b,
      days,
      getBaryOffset(),
      distScale,
      sizeMode,
      helioScale,
      systemBodies,
      faceOn,
      fitScale,
    );
    desired.current.set(pos[0], pos[1], pos[2]);

    // Sync offset from what OrbitControls did (dolly / orbit / pan) relative
    // to the previous target — preserves user zoom distance.
    if (controls?.target) {
      offset.current.copy(camera.position).sub(controls.target);
    } else {
      offset.current.copy(camera.position).sub(target.current);
    }

    // Ride-along: yaw from heliocentric bearing (ignore barycentric translation).
    const bearing = Math.atan2(helio[0], helio[2]);
    if (lastBearing.current != null) {
      const dYaw = wrapDeltaAngle(bearing - lastBearing.current);
      if (dYaw !== 0) {
        const len = offset.current.length();
        offset.current.applyAxisAngle(Y_AXIS, dYaw);
        // Keep length stable through rotation (user zoom owns length).
        if (len > 1e-6) offset.current.setLength(len);
      }
    }
    lastBearing.current = bearing;

    // Snap target on the final follow frames — no lag left to bleed past unfocus.
    const lerp = 1 - Math.exp(-8 * delta);
    target.current.lerp(desired.current, lerp);

    camera.position.copy(target.current).add(offset.current);
    if (controls?.target) {
      controls.target.copy(target.current);
      // update() re-reads camera→spherical so the next user gesture
      // continues from the ride-along pose without a jump.
      controls.update();
    } else {
      camera.lookAt(target.current);
    }
  });

  return null;
}


/**
 * WASD fly while the Explore canvas is focused (click into the WebGL view).
 * W/S forward/back, A/D strafe, Space up, Control down, Shift speed boost.
 * Moves relative to camera facing; skips when focus is an input/UI control.
 * Idle: pan camera + OrbitControls target together. Follow: move camera only
 * so the ride-along offset changes without fighting the body target.
 */
function WasdFly() {
  const keys = useRef({
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
    ctrl: false,
    shift: false,
  });
  /** True after pointerdown on the WebGL canvas until pointerdown outside it. */
  const canvasArmed = useRef(false);
  const { getFollowing } = useSimApi();
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  const up = useRef(new THREE.Vector3());
  const move = useRef(new THREE.Vector3());

  useEffect(() => {
    const canvas = gl.domElement;

    const isTypingTarget = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t.isContentEditable
      );
    };

    const clearKeys = () => {
      keys.current = {
        w: false,
        a: false,
        s: false,
        d: false,
        space: false,
        ctrl: false,
        shift: false,
      };
    };

    const onCanvasPointerDown = () => {
      canvasArmed.current = true;
    };
    const onDocPointerDown = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Node && canvas.contains(t)) return;
      canvasArmed.current = false;
      clearKeys();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!canvasArmed.current) return;
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) {
        return;
      }
      const k = e.key.toLowerCase();
      let handled = false;
      if (k === "w" || k === "a" || k === "s" || k === "d") {
        if (!keys.current[k]) {
          keys.current[k] = true;
          handled = true;
        }
      } else if (e.code === "Space" || k === " ") {
        if (!keys.current.space) {
          keys.current.space = true;
          handled = true;
        }
      } else if (k === "control") {
        if (!keys.current.ctrl) {
          keys.current.ctrl = true;
          handled = true;
        }
      } else if (k === "shift") {
        if (!keys.current.shift) {
          keys.current.shift = true;
          handled = true;
        }
      }
      if (handled) {
        e.preventDefault();
        invalidate();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "w" || k === "a" || k === "s" || k === "d") {
        keys.current[k] = false;
      } else if (e.code === "Space" || k === " ") {
        keys.current.space = false;
      } else if (k === "control") {
        keys.current.ctrl = false;
      } else if (k === "shift") {
        keys.current.shift = false;
      }
    };

    const onVis = () => {
      if (document.hidden) clearKeys();
    };

    canvas.addEventListener("pointerdown", onCanvasPointerDown);
    document.addEventListener("pointerdown", onDocPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      canvas.removeEventListener("pointerdown", onCanvasPointerDown);
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [gl, invalidate]);

  useFrame((_, delta) => {
    if (typeof document !== "undefined" && document.hidden) return;
    const { w, a, s, d, space, ctrl, shift } = keys.current;
    if (!(w || a || s || d || space || ctrl) || !canvasArmed.current) return;

    camera.getWorldDirection(forward.current);
    if (forward.current.lengthSq() < 1e-12) return;
    forward.current.normalize();
    right.current.crossVectors(forward.current, camera.up);
    if (right.current.lengthSq() < 1e-12) {
      right.current.set(1, 0, 0);
    } else {
      right.current.normalize();
    }
    up.current.copy(camera.up).normalize();

    move.current.set(0, 0, 0);
    if (w) move.current.add(forward.current);
    if (s) move.current.sub(forward.current);
    if (d) move.current.add(right.current);
    if (a) move.current.sub(right.current);
    if (space) move.current.add(up.current);
    if (ctrl) move.current.sub(up.current);
    if (move.current.lengthSq() < 1e-12) return;
    move.current.normalize();

    // Base fly is intentionally gentle; Shift still boosts for long hops.
    let speed = 1.1;
    if (controls?.target) {
      const dist = camera.position.distanceTo(controls.target);
      speed = Math.max(0.18, Math.min(6, dist * 0.4));
    }
    if (shift) speed *= 2.75;
    move.current.multiplyScalar(speed * Math.min(delta, 0.1));

    camera.position.add(move.current);
    // Follow owns the look-at; only nudge camera so offset updates.
    if (!getFollowing() && controls?.target) {
      controls.target.add(move.current);
      controls.update();
    }
    invalidate();
  });

  return null;
}

/**
 * Demand frameloop driver: advance shared simDays on the same wall rAF that
 * calls invalidate(). Coupling clock + invalidate in one loop avoids demand-mode
 * stalls where OrbitControls autoRotate still spins the camera (controls.update
 * in useFrame) while BodyMesh samples a clock that never moved (R3F delta≈0 or
 * a ticker that only ran when frames were already flowing for another reason).
 * Pauses while the tab is hidden.
 */
function SimDriver({
  active,
  simDaysRef,
  rateRef,
}: {
  active: boolean;
  simDaysRef: React.MutableRefObject<number>;
  rateRef: React.MutableRefObject<number>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!active) return;
    let id = 0;
    let alive = true;
    let lastWall: number | null = null;
    const loop = (now: number) => {
      if (!alive) return;
      if (typeof document !== "undefined" && document.hidden) {
        lastWall = null;
      } else {
        if (lastWall != null) {
          const dt = Math.min((now - lastWall) / 1000, 0.25);
          simDaysRef.current += dt * rateRef.current;
        }
        lastWall = now;
        invalidate();
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    const onVis = () => {
      if (!document.hidden) {
        lastWall = null; // avoid a huge catch-up step
        invalidate();
      } else {
        lastWall = null;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      cancelAnimationFrame(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [active, invalidate, simDaysRef, rateRef]);
  return null;
}

/**
 * Translates the whole heliocentric system by the viz-only sun wobble so
 * orbit ellipses stay glued to bodies and the sun describes a small circle
 * about the scene origin (barycenter). Not a catalog orbit — no OrbitLine.
 *
 * Freeze contract: while not following an orbiter (idle or sun/star focus),
 * hold the last applied offset. Live wobble under a world-fixed camera looks
 * like a pan on unfocus; freezing the root keeps camera.position /
 * controls.target bit-stable without rewriting the pose every idle frame
 * (so manual OrbitControls still work).
 */
function BarycentricRoot({
  children,
  focusId,
}: {
  children: React.ReactNode;
  focusId?: string | null;
}) {
  const group = useRef<THREE.Group>(null);
  const { getSimDays, getFollowing, getBaryOffset } = useSimApi();
  const sizeMode = useSizeMode();
  const distScale = orbitDistanceScale(sizeMode);
  const { faceOn } = useSystemViz();

  const applyOffset = (next: readonly [number, number, number]) => {
    const cur = getBaryOffset() as [number, number, number];
    cur[0] = next[0];
    cur[1] = next[1];
    cur[2] = next[2];
    if (group.current) group.current.position.set(next[0], next[1], next[2]);
  };

  // Runs before FollowCamera's layout snap (declared earlier in the tree) so
  // bodyWorldPosition(getBaryOffset(), helioScale) matches the group translation.
  useLayoutEffect(() => {
    if (getFollowing()) {
      applyOffset(sunBarycentricOffset(getSimDays(), distScale, faceOn));
    } else if (group.current) {
      const [x, y, z] = getBaryOffset();
      group.current.position.set(x, y, z);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync on focus edge only
  }, [focusId]);

  useFrame(() => {
    if (!group.current) return;
    // Idle / sun focus / unfocus: hold last offset bit-stable. Live wobble under
    // a world-fixed camera is the classic unfocus "left pan".
    if (!getFollowing()) {
      const [x, y, z] = getBaryOffset();
      if (
        group.current.position.x !== x ||
        group.current.position.y !== y ||
        group.current.position.z !== z
      ) {
        group.current.position.set(x, y, z);
      }
      return;
    }
    applyOffset(sunBarycentricOffset(getSimDays(), distScale, faceOn));
  });

  return <group ref={group}>{children}</group>;
}

function SimProvider({
  focusId,
  simDaysPerSec = DEFAULT_SIM_DAYS_PER_SEC,
  children,
}: {
  focusId?: string | null;
  simDaysPerSec?: number;
  children: React.ReactNode;
}) {
  const simDaysRef = useRef(0);
  const rateRef = useRef(simDaysPerSec);
  rateRef.current = simDaysPerSec;
  /** Applied barycentric translation; mutated in place by BarycentricRoot. */
  const baryOffsetRef = useRef<[number, number, number]>([0, 0, 0]);

  const followingRef = useRef(focusIsOrbiter(focusId));
  followingRef.current = focusIsOrbiter(focusId);
  const focusIdRef = useRef(focusId);
  focusIdRef.current = focusId;

  // Stable API object: memoized BodyMesh useFrame always calls fresh getters.
  const api = useRef<SimApi>({
    getSimDays: () => simDaysRef.current,
    getFollowing: () => followingRef.current,
    getFocusId: () => focusIdRef.current,
    getBaryOffset: () => baryOffsetRef.current,
  }).current;

  return (
    <SimContext.Provider value={api}>
      {/* Clock + invalidate share one wall rAF — works idle and follow. */}
      <SimDriver active simDaysRef={simDaysRef} rateRef={rateRef} />
      {children}
    </SimContext.Provider>
  );
}

function SceneContent({
  focusId,
  onSelect,
  selectedPoiId,
  onSelectPoi,
  highlightColor,
  simDaysPerSec,
  sizeMode = DEFAULT_SIZE_MODE,
  hiddenIds,
  hideOrbitPathKinds,
  hideProbeMeshes = false,
  systemId,
  viewInsetLeft = 0,
  viewInsetRight = 0,
}: Props) {
  const resolvedSystemId = systemId ?? getHomeSystem().id;
  const systemGraph = useMemo(
    () => getSystemGraph(resolvedSystemId),
    [resolvedSystemId],
  );
  const systemBodies = systemGraph.bodies;
  const clearanceHelio = useMemo(
    () => heliocentricDisplayScale(systemBodies, sizeMode),
    [systemBodies, sizeMode],
  );
  // Home (Sol): always fitScale=1. Schematic-only compress for wide/sparse hosts.
  const isHome = systemGraph.system.home === true;
  const fitScale = useMemo(() => {
    if (sizeMode !== "schematic" || isHome) return 1;
    return schematicOrbitFitScale(systemBodies, clearanceHelio);
  }, [sizeMode, isHome, systemBodies, clearanceHelio]);
  // Keep perihelion clearance after fit compress (do not floor at 1).
  const helioScale = Math.max(
    clearanceHelio * fitScale,
    perihelionClearanceFloor(systemBodies, sizeMode),
  );
  const faceOn = useMemo(
    () => systemFaceOnRotation(systemBodies),
    [systemBodies],
  );
  const primaryStarId = useMemo(() => {
    const declared = systemGraph.system.primaryStarId;
    if (declared) return declared;
    return findPrimaryHost(systemBodies)?.id;
  }, [systemGraph, systemBodies]);
  const systemViz = useMemo(
    () => ({ bodies: systemBodies, helioScale, fitScale, faceOn, primaryStarId }),
    [systemBodies, helioScale, fitScale, faceOn, primaryStarId],
  );

  const bodyById = useMemo(() => {
    const m = new Map<string, Body>();
    for (const b of systemBodies) m.set(b.id, b);
    return m;
  }, [systemBodies]);

  // Orbit ellipses / meshes: primary + companions (Kepler or visual-binary) +
  // orbiters. Sun wobble is BarycentricRoot viz-only; no catalog OrbitLine.
  // OrbitLine only for hasUsableOrbit — orbit-unknown companions get mesh only.
  const sceneBodies = useMemo(
    () =>
      systemBodies.filter((b) =>
        isExploreSceneBody(b, primaryStarId, bodyById),
      ),
    [systemBodies, primaryStarId, bodyById],
  );
  const visibleOrbiters = useMemo(() => {
    let orbiters = sceneBodies.filter((b) => hasUsableOrbit(b));
    if (hiddenIds && hiddenIds.size > 0) {
      orbiters = orbiters.filter((b) => !hiddenIds.has(b.id));
    }
    orbiters = orbiters.filter(
      (b) => !orbitPathsHiddenFor(b.kind, hideOrbitPathKinds),
    );
    return orbiters;
  }, [sceneBodies, hiddenIds, hideOrbitPathKinds]);
  const visibleBodies = useMemo(() => {
    if (!hiddenIds || hiddenIds.size === 0) return sceneBodies;
    return sceneBodies.filter((b) => !hiddenIds.has(b.id));
  }, [sceneBodies, hiddenIds]);
  // Sat mesh / OrbitLine LOD ranks (system-agnostic; N≤cap keeps all mesh-eligible).
  const visibleSats = useMemo(
    () => visibleBodies.filter((b) => b.kind === "satellite"),
    [visibleBodies],
  );
  const satCount = visibleSats.length;
  const satMeshRanks = useMemo(
    () => assignSatMeshRanks(visibleSats, focusId),
    [visibleSats, focusId],
  );
  const geoSatCount = useMemo(
    () =>
      visibleOrbiters.filter((b) => b.orbit?.frame === "geocentric").length,
    [visibleOrbiters],
  );
  // Idle system view: no camera autoRotate (user orbits manually).
  // Follow mode still ride-alongs when a planet is selected.
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const focusBody = focusId ? getBody(focusId) : null;
  const cameraNear =
    camera instanceof THREE.PerspectiveCamera ? camera.near : CAMERA_NEAR;
  const minDistance = orbitMinDistance(
    sizeMode,
    focusBody,
    cameraNear,
    systemBodies,
  );

  return (
    <SystemVizContext.Provider value={systemViz}>
    <SizeModeContext.Provider value={sizeMode}>
    <SimProvider focusId={focusId} simDaysPerSec={simDaysPerSec}>
      <color attach="background" args={["#02040a"]} />
      <Starfield />
      <SoftHaze />
      <ambientLight
        intensity={resolvedSystemId === EARTH_SATS_SYSTEM_ID ? 0.48 : 0.32}
      />
      {resolvedSystemId === EARTH_SATS_SYSTEM_ID ? (
        <>
          {/* Dim distant Sun backdrop — not a catalog body. */}
          <directionalLight
            position={[48, 22, 36]}
            intensity={0.9}
            color="#fff2dd"
          />
          <mesh position={[70, 32, 52]} frustumCulled={false}>
            <sphereGeometry args={[1.1, 16, 16]} />
            <meshBasicMaterial color="#FDB813" />
          </mesh>
        </>
      ) : null}
      <BarycentricRoot focusId={focusId}>
        {/* pointLight lives on each star BodyMesh (primary strong; companions dimmed) */}
        {visibleOrbiters.map((b) => {
          // Geocentric OrbitLine LOD: focused always; all when N≤cap; else neighbors only.
          if (b.orbit?.frame === "geocentric") {
            const rank = satMeshRanks.get(b.id) ?? 999;
            if (
              !shouldDrawGeocentricOrbitLine({
                focused: focusId === b.id,
                geoSatCount,
                meshRank: rank,
              })
            ) {
              return null;
            }
          }
          return (
            <OrbitLine
              key={`o-${b.id}`}
              body={b}
              highlighted={focusId === b.id}
              highlightColor={highlightColor}
            />
          );
        })}
        {visibleBodies.map((b) => (
          <BodyMesh
            key={`${b.id}-${sizeMode}`}
            body={b}
            focused={focusId === b.id}
            onSelect={onSelect}
            highlightColor={highlightColor}
            selectedPoiId={focusId === b.id ? selectedPoiId : null}
            onSelectPoi={onSelectPoi}
            hideOrbitPathKinds={hideOrbitPathKinds}
            hideProbeMeshes={hideProbeMeshes}
            satLod={
              b.kind === "satellite"
                ? {
                    satCount,
                    meshRank: satMeshRanks.get(b.id) ?? 999,
                  }
                : undefined
            }
          />
        ))}
      </BarycentricRoot>
      <ViewOffsetController
        insetLeft={viewInsetLeft}
        insetRight={viewInsetRight}
      />
      <OrbitControls
        makeDefault
        enablePan
        enableZoom
        enableRotate
        autoRotate={false}
        enableDamping={false}
        minDistance={minDistance}
        maxDistance={80}
        onChange={() => invalidate()}
      />
      <IdleCameraBootstrap focusId={focusId} hideProbeMeshes={hideProbeMeshes} />
      <FollowCamera />
      <WasdFly />
    </SimProvider>
    </SizeModeContext.Provider>
    </SystemVizContext.Provider>
  );
}

export function OrbitScene({
  focusId,
  onSelect,
  selectedPoiId,
  onSelectPoi,
  highlightColor,
  simDaysPerSec,
  sizeMode = DEFAULT_SIZE_MODE,
  hiddenIds,
  hideOrbitPathKinds,
  hideProbeMeshes,
  systemId,
  viewInsetLeft = 0,
  viewInsetRight = 0,
}: Props) {
  return (
    <div
      className="h-full w-full"
      onContextMenu={(e) => {
        e.preventDefault();
        onSelectPoi?.(null);
        onSelect?.(null);
      }}
    >
      <Canvas
        frameloop="demand"
        camera={{
          position: [...IDLE_CAMERA_OFFSET],
          fov: 45,
          near: CAMERA_NEAR,
          far: 5000,
        }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onPointerMissed={() => {
          /* keep selection on empty left-click; Esc / right-click / toggle clear */
        }}
      >
        <SceneContent
          focusId={focusId}
          onSelect={onSelect}
          selectedPoiId={selectedPoiId}
          onSelectPoi={onSelectPoi}
          highlightColor={highlightColor}
          simDaysPerSec={simDaysPerSec}
          sizeMode={sizeMode}
          hiddenIds={hiddenIds}
          hideOrbitPathKinds={hideOrbitPathKinds}
          hideProbeMeshes={hideProbeMeshes}
          systemId={systemId}
          viewInsetLeft={viewInsetLeft}
          viewInsetRight={viewInsetRight}
        />
      </Canvas>
    </div>
  );
}
