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
} from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  getBody,
  getHomeSystemGraph,
  getParent,
  hasUsableOrbit,
  listChildren,
} from "@/data/catalog";
import type { Body } from "@/data/schema";

/** Explore default: one system graph (home = solar). Additive systems plug in later. */
const { bodies: systemBodies } = getHomeSystemGraph();
import { periodFromA, positionAtMa, sampleOrbit } from "@/lib/kepler";
import {
  DEFAULT_SIZE_MODE,
  orbitDistanceScale,
  parentFrameSharedDisplayScale,
  visualRadius,
  type SizeMode,
} from "./sizeTiers";

/** Must match <Canvas camera.near> — focus floors stay outside the near plane. */
const CAMERA_NEAR = 0.01;

type Props = {
  focusId?: string | null;
  onSelect?: (id: string | null) => void;
  highlightColor?: string;
  /** Simulated days advanced per real second (idle + follow). UI owns presets. */
  simDaysPerSec?: number;
  /** Mesh size mode — render layer on catalog radii (default schematic). */
  sizeMode?: SizeMode;
  /** Session-only ids with mesh + orbit line suppressed (Explore hide). */
  hiddenIds?: ReadonlySet<string>;
  /**
   * Canvas-space insets (px) covered by Explore overlays. BodyRail is a flex
   * sibling (outside the canvas) so left is usually 0; Facts overlays the
   * right when a body is selected (~288–320px on md+).
   */
  viewInsetLeft?: number;
  viewInsetRight?: number;
};

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

/** True only when focus refers to a body with a usable orbit (not sun / not star). */
function focusIsOrbiter(focusId?: string | null): boolean {
  if (!focusId) return false;
  const b = getBody(focusId);
  return Boolean(b && hasUsableOrbit(b));
}

function eclipticToScene(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y];
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
): [number, number, number] {
  const s = distScale > 0 ? distScale : 1;
  const ang = (2 * Math.PI * simDays) / SUN_WOBBLE_PERIOD_D;
  const x = SUN_WOBBLE_RADIUS_AU * s * Math.cos(ang);
  const y = SUN_WOBBLE_RADIUS_AU * s * Math.sin(ang);
  return eclipticToScene(x, y, 0);
}

/**
 * Periapsis (au) from elements — matches catalog qAu when present.
 */
function orbitQAu(orbit: NonNullable<Body["orbit"]>): number {
  if (orbit.qAu != null && Number.isFinite(orbit.qAu)) return orbit.qAu;
  return orbit.aAu * (1 - orbit.e);
}

/**
 * Viz-only parent-frame orbit inflate. Shared per parent so Galileans / etc.
 * keep relative spacing instead of each child independently mapping to the
 * same display periapsis (catalog a/e/i unchanged).
 */
function parentDisplayScale(body: Body, sizeMode: SizeMode): number {
  if (body.orbit?.frame !== "parent" || !body.parentId) return 1;
  const parent = getParent(body.id) ?? getBody(body.parentId);
  if (!parent) return 1;
  const kids = listChildren(parent.id).filter(
    (c) => c.orbit?.frame === "parent" && hasUsableOrbit(c),
  );
  if (kids.length === 0) return 1;
  return parentFrameSharedDisplayScale(
    visualRadius(parent, sizeMode),
    kids.map((c) => {
      const o = c.orbit!;
      return {
        qAu: orbitQAu(o),
        aAu: o.aAu,
        e: o.e,
        vis: visualRadius(c, sizeMode),
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
): [number, number, number] {
  if (body.kind === "star" || !body.orbit) return [0, 0, 0];
  const period = body.orbit.periodD ?? periodFromA(body.orbit.aAu);
  const ma = body.orbit.maDeg + (360 * simDays) / period;
  const [x, y, z] = positionAtMa(body.orbit, ma);
  const s = relScale > 0 ? relScale : 1;
  return eclipticToScene(x * s, y * s, z * s);
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
  seen: Set<string> = new Set(),
): [number, number, number] {
  if (body.kind === "star" || !body.orbit) return [0, 0, 0];
  if (seen.has(body.id)) return [0, 0, 0];
  seen.add(body.id);

  const s = distScale > 0 ? distScale : 1;
  if (body.orbit.frame === "parent" && body.parentId) {
    const parent = getParent(body.id) ?? getBody(body.parentId);
    if (parent) {
      const parentPos = bodyPosition(parent, simDays, distScale, sizeMode, seen);
      const ps = parentDisplayScale(body, sizeMode);
      const local = localOrbitPosition(body, simDays, s * ps);
      return [
        parentPos[0] + local[0],
        parentPos[1] + local[1],
        parentPos[2] + local[2],
      ];
    }
  }
  return localOrbitPosition(body, simDays, s);
}

/** World-space position including the applied barycentric translation. */
function bodyWorldPosition(
  body: Body,
  simDays: number,
  bary: readonly [number, number, number],
  distScale: number = 1,
  sizeMode: SizeMode = DEFAULT_SIZE_MODE,
): [number, number, number] {
  const [x, y, z] = bodyPosition(body, simDays, distScale, sizeMode);
  return [x + bary[0], y + bary[1], z + bary[2]];
}

const sharedSunMat = new THREE.MeshBasicMaterial({ color: "#FDB813" });

/** Slow yaw for idle starfield drift (rad/s). Tiny — readable only over many seconds. */
const STARFIELD_DRIFT_RAD_PER_SEC = 0.004;

function Starfield({ count = 3200 }: { count?: number }) {
  const group = useRef<THREE.Points>(null);
  const { positions, colors } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const r = 55 + Math.random() * 90;
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
      <sphereGeometry args={[28, 24, 16]} />
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
  const { getSimDays } = useSimApi();
  const parent =
    body.orbit?.frame === "parent" && body.parentId
      ? getParent(body.id) ?? getBody(body.parentId)
      : undefined;
  const relScale = useMemo(() => {
    if (!hasUsableOrbit(body)) return distScale;
    if (!parent) return distScale;
    return distScale * parentDisplayScale(body, sizeMode);
  }, [body, parent, distScale, sizeMode]);

  const points = useMemo(() => {
    if (!hasUsableOrbit(body)) return null;
    // True-anomaly sampling (see sampleOrbit) keeps eccentric bodies on the polyline.
    return sampleOrbit(body.orbit, ORBIT_LINE_SAMPLES).map(([x, y, z]) => {
      const [sx, sy, sz] = eclipticToScene(x * relScale, y * relScale, z * relScale);
      return new THREE.Vector3(sx, sy, sz);
    });
  }, [body.orbit, relScale]);

  const syncParent = (days: number) => {
    if (!parent || !group.current) return;
    const [x, y, z] = bodyPosition(parent, days, distScale, sizeMode);
    group.current.position.set(x, y, z);
  };

  useLayoutEffect(() => {
    syncParent(getSimDays());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- parent pose sync
  }, [parent, distScale, sizeMode]);

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

const BodyMesh = memo(function BodyMesh({
  body,
  focused,
  onSelect,
  highlightColor,
}: {
  body: Body;
  focused: boolean;
  onSelect?: (id: string | null) => void;
  highlightColor?: string;
}) {
  const group = useRef<THREE.Group>(null);
  const { getSimDays } = useSimApi();
  const sizeMode = useSizeMode();
  const distScale = orbitDistanceScale(sizeMode);
  const r = visualRadius(body, sizeMode);
  const color = body.color ?? "#888";
  const accent = highlightColor ?? color;

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

  const spinMesh = useRef<THREE.Mesh>(null);

  const applyPose = (days: number) => {
    if (!group.current) return;
    const [x, y, z] = bodyPosition(body, days, distScale, sizeMode);
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
    return (
      <group ref={group} name={body.id}>
        {/* Viz-only barycentric wobble drives this group via useFrame; no OrbitLine. */}
        <pointLight intensity={2.2} distance={80} />
        <mesh
          ref={spinMesh}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          material={sharedSunMat}
          scale={focused ? 1.2 : 1}
        >
          <sphereGeometry args={[r, 32, 32]} />
        </mesh>
      </group>
    );
  }

  return (
    <group ref={group} name={body.id}>
      <mesh
        ref={spinMesh}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        scale={focused ? 1.35 : 1}
      >
        <sphereGeometry args={[r, 24, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={focused ? accent : "#000000"}
          emissiveIntensity={focused ? 0.45 : 0}
        />
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
  return body.kind === "star" ? 1.2 : 1.35;
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
): number {
  const idle = sizeMode === "true" ? 0.23 : 0.4;
  if (!focusBody) return idle;
  const r = visualRadius(focusBody, sizeMode) * focusMeshScale(focusBody);
  const near = cameraNear > 0 ? cameraNear : CAMERA_NEAR;
  return Math.max(r * 2.2, near + r, 0.004);
}

/** Auto-frame floor — tracks orbitMinDistance so focus snap can use the dolly. */
function focusDistanceFloor(
  sizeMode: SizeMode,
  focusBody?: Body | null,
  cameraNear: number = CAMERA_NEAR,
): number {
  if (focusBody) {
    const r = visualRadius(focusBody, sizeMode) * focusMeshScale(focusBody);
    const near = cameraNear > 0 ? cameraNear : CAMERA_NEAR;
    // Strictly outside the focused mesh (+ margin) and in front of near plane.
    return Math.max(r * 2.5, near + r, 0.0035);
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
): number {
  const r = visualRadius(body, sizeMode) * focusMeshScale(body);
  const halfRad = ((fovYDeg * Math.PI) / 180) / 2;
  const tanHalf = Math.tan(halfRad);
  if (!(tanHalf > 1e-6) || !(fill > 1e-6)) return 12;
  // PerspectiveCamera fov is vertical; half-extent for min(w,h). Prefer the
  // smaller of vertical/horizontal so a skewed visibleAspect (viewOffset /
  // portrait) cannot enlarge halfMin and pull the camera inside the mesh.
  const a = Number.isFinite(aspect) && aspect > 1e-6 ? aspect : 1;
  const halfMin = Math.min(tanHalf, tanHalf * a);
  const framed = r / (fill * halfMin);
  return Math.max(focusDistanceFloor(sizeMode, body, cameraNear), framed);
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
 */
function FollowCamera() {
  const sizeMode = useSizeMode();
  const distScale = orbitDistanceScale(sizeMode);
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
      return;
    }
    const b = getBody(focusId ?? "");
    if (!b) {
      wasFollowing.current = false;
      freezePoseRefs();
      return;
    }
    poseFrozen.current = false;
    const days = getSimDays();
    const helio = bodyPosition(b, days, distScale, sizeMode);
    const pos = bodyWorldPosition(b, days, getBaryOffset(), distScale, sizeMode);
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
    invalidate();
  }, [focusId, camera, controls, invalidate, distScale, sizeMode]); // eslint-disable-line react-hooks/exhaustive-deps -- snap on focus acquire / size mode

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
    const helio = bodyPosition(b, days, distScale, sizeMode);
    const pos = bodyWorldPosition(b, days, getBaryOffset(), distScale, sizeMode);
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

  const applyOffset = (next: readonly [number, number, number]) => {
    const cur = getBaryOffset() as [number, number, number];
    cur[0] = next[0];
    cur[1] = next[1];
    cur[2] = next[2];
    if (group.current) group.current.position.set(next[0], next[1], next[2]);
  };

  // Runs before FollowCamera's layout snap (declared earlier in the tree) so
  // bodyWorldPosition(getBaryOffset()) matches the group translation.
  useLayoutEffect(() => {
    if (getFollowing()) {
      applyOffset(sunBarycentricOffset(getSimDays(), distScale));
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
    applyOffset(sunBarycentricOffset(getSimDays(), distScale));
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
  highlightColor,
  simDaysPerSec,
  sizeMode = DEFAULT_SIZE_MODE,
  hiddenIds,
  viewInsetLeft = 0,
  viewInsetRight = 0,
}: Props) {
  // Orbit ellipses from system graph elements — skip if no usable orbit.
  // Sun wobble is BarycentricRoot viz-only; no catalog OrbitLine.
  const orbiters = useMemo(
    () => systemBodies.filter((b) => hasUsableOrbit(b)),
    [],
  );
  const visibleOrbiters = useMemo(
    () =>
      hiddenIds && hiddenIds.size > 0
        ? orbiters.filter((b) => !hiddenIds.has(b.id))
        : orbiters,
    [orbiters, hiddenIds],
  );
  const visibleBodies = useMemo(
    () =>
      hiddenIds && hiddenIds.size > 0
        ? systemBodies.filter((b) => !hiddenIds.has(b.id))
        : systemBodies,
    [hiddenIds],
  );
  // Idle system view: no camera autoRotate (user orbits manually).
  // Follow mode still ride-alongs when a planet is selected.
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const focusBody = focusId ? getBody(focusId) : null;
  const cameraNear =
    camera instanceof THREE.PerspectiveCamera ? camera.near : CAMERA_NEAR;
  const minDistance = orbitMinDistance(sizeMode, focusBody, cameraNear);

  return (
    <SizeModeContext.Provider value={sizeMode}>
    <SimProvider focusId={focusId} simDaysPerSec={simDaysPerSec}>
      <color attach="background" args={["#02040a"]} />
      <Starfield />
      <SoftHaze />
      <ambientLight intensity={0.32} />
      <BarycentricRoot focusId={focusId}>
        {/* pointLight lives on the sun BodyMesh so it follows barycentric wobble */}
        {visibleOrbiters.map((b) => (
          <OrbitLine
            key={`o-${b.id}`}
            body={b}
            highlighted={focusId === b.id}
            highlightColor={highlightColor}
          />
        ))}
        {visibleBodies.map((b) => (
          <BodyMesh
            key={`${b.id}-${sizeMode}`}
            body={b}
            focused={focusId === b.id}
            onSelect={onSelect}
            highlightColor={highlightColor}
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
      <FollowCamera />
      <WasdFly />
    </SimProvider>
    </SizeModeContext.Provider>
  );
}

export function OrbitScene({
  focusId,
  onSelect,
  highlightColor,
  simDaysPerSec,
  sizeMode = DEFAULT_SIZE_MODE,
  hiddenIds,
  viewInsetLeft = 0,
  viewInsetRight = 0,
}: Props) {
  return (
    <div
      className="h-full w-full"
      onContextMenu={(e) => {
        e.preventDefault();
        onSelect?.(null);
      }}
    >
      <Canvas
        frameloop="demand"
        camera={{ position: [0, 8, 14], fov: 45, near: CAMERA_NEAR, far: 250 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onPointerMissed={() => {
          /* keep selection on empty left-click; Esc / right-click / toggle clear */
        }}
      >
        <SceneContent
          focusId={focusId}
          onSelect={onSelect}
          highlightColor={highlightColor}
          simDaysPerSec={simDaysPerSec}
          sizeMode={sizeMode}
          hiddenIds={hiddenIds}
          viewInsetLeft={viewInsetLeft}
          viewInsetRight={viewInsetRight}
        />
      </Canvas>
    </div>
  );
}
