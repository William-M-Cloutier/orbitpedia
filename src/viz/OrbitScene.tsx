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
import { bodies } from "@/data/catalog";
import type { Body } from "@/data/schema";
import { periodFromA, positionAtMa, sampleOrbit } from "@/lib/kepler";
import { visualRadius } from "./sizeTiers";

type Props = {
  focusId?: string | null;
  onSelect?: (id: string | null) => void;
  highlightColor?: string;
  /** Simulated days advanced per real second (idle + follow). UI owns presets. */
  simDaysPerSec?: number;
};

/** Fallback when UI omits speed — matches Explore Default preset (0.2 d/s = 1 day / 5s). */
const DEFAULT_SIM_DAYS_PER_SEC = 0.2;

type SimApi = {
  /** Shared simulated days since Explore mounted (paused while tab hidden). */
  getSimDays: () => number;
  /** True when focus is an orbiter (ride-along follow). */
  getFollowing: () => boolean;
  getFocusId: () => string | null | undefined;
};

const SimContext = createContext<SimApi | null>(null);

function useSimApi(): SimApi {
  const api = useContext(SimContext);
  if (!api) {
    throw new Error("useSimApi must be used inside SimProvider");
  }
  return api;
}

/** True only when focus refers to a body that has an orbit (not sun / not star). */
function focusIsOrbiter(focusId?: string | null): boolean {
  if (!focusId) return false;
  const b = bodies.find((x) => x.id === focusId);
  return Boolean(b?.orbit && b.kind !== "star");
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

function sunBarycentricOffset(simDays: number): [number, number, number] {
  const ang = (2 * Math.PI * simDays) / SUN_WOBBLE_PERIOD_D;
  const x = SUN_WOBBLE_RADIUS_AU * Math.cos(ang);
  const y = SUN_WOBBLE_RADIUS_AU * Math.sin(ang);
  return eclipticToScene(x, y, 0);
}

/** Heliocentric (sun-at-origin) scene position. BarycentricRoot adds the wobble. */
function bodyPosition(
  body: Body,
  simDays: number,
): [number, number, number] {
  if (body.kind === "star" || !body.orbit) return [0, 0, 0];
  const period = body.orbit.periodD ?? periodFromA(body.orbit.aAu);
  const ma = body.orbit.maDeg + (360 * simDays) / period;
  const [x, y, z] = positionAtMa(body.orbit, ma);
  return eclipticToScene(x, y, z);
}

/** World-space position including viz-only barycentric sun wobble. */
function bodyWorldPosition(
  body: Body,
  simDays: number,
): [number, number, number] {
  const [bx, by, bz] = sunBarycentricOffset(simDays);
  const [x, y, z] = bodyPosition(body, simDays);
  return [x + bx, y + by, z + bz];
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

const OrbitLine = memo(function OrbitLine({
  body,
  highlighted,
  highlightColor,
}: {
  body: Body;
  highlighted: boolean;
  highlightColor?: string;
}) {
  const points = useMemo(() => {
    if (!body.orbit) return null;
    return sampleOrbit(body.orbit, 96).map(([x, y, z]) => {
      const [sx, sy, sz] = eclipticToScene(x, y, z);
      return new THREE.Vector3(sx, sy, sz);
    });
  }, [body.orbit]);

  if (!points) return null;
  const base = body.color ?? "#666";
  const color = highlighted ? (highlightColor ?? base) : base;
  return (
    <Line
      points={points}
      color={color}
      lineWidth={highlighted ? 2.2 : 1}
      transparent
      opacity={highlighted ? 0.85 : 0.4}
    />
  );
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
  const r = visualRadius(body);
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
    const [x, y, z] = bodyPosition(body, days);
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
 * FollowCamera: slides look-at with the body, rides along by yawing the
 * camera offset with orbital bearing change, and never overwrites distance —
 * user OrbitControls dolly/orbit/pan still win on offset length/direction.
 */
function FollowCamera() {
  const { getSimDays, getFollowing, getFocusId } = useSimApi();
  const focusId = getFocusId();
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const invalidate = useThree((s) => s.invalidate);
  const target = useRef(new THREE.Vector3(0, 0, 0));
  const desired = useRef(new THREE.Vector3(0, 0, 0));
  const offset = useRef(new THREE.Vector3());
  const lastBearing = useRef<number | null>(null);

  // Snap / re-frame only when acquiring a focus. Clearing focus must leave
  // camera position + OrbitControls target/zoom as-is (stop Follow tracking only).
  useEffect(() => {
    if (!focusId) {
      lastBearing.current = null;
      return;
    }
    const b = bodies.find((x) => x.id === focusId);
    if (!b) {
      lastBearing.current = null;
      return;
    }
    const days = getSimDays();
    const helio = bodyPosition(b, days);
    const pos = bodyWorldPosition(b, days);
    const dist = b.orbit
      ? Math.max(1.2, b.orbit.aAu * 0.55 + 1.5)
      : 12;
    target.current.set(pos[0], pos[1], pos[2]);
    desired.current.copy(target.current);
    camera.position.set(
      pos[0] + dist * 0.6,
      dist * 0.45,
      pos[2] + dist * 0.7,
    );
    camera.lookAt(target.current);
    if (controls?.target) {
      controls.target.copy(target.current);
      controls.update();
    }
    offset.current.copy(camera.position).sub(target.current);
    lastBearing.current = focusIsOrbiter(focusId)
      ? Math.atan2(helio[0], helio[2])
      : null;
    invalidate();
  }, [focusId, camera, controls, invalidate]); // eslint-disable-line react-hooks/exhaustive-deps -- snap on focus acquire only

  useFrame((_, delta) => {
    const followingNow = getFollowing();
    const focusNow = getFocusId();
    if (!followingNow || !focusNow) return;

    const b = bodies.find((x) => x.id === focusNow);
    if (!b?.orbit) return;

    const days = getSimDays();
    const helio = bodyPosition(b, days);
    const pos = bodyWorldPosition(b, days);
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

    const lerp = 1 - Math.exp(-4 * delta);
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
 */
function BarycentricRoot({ children }: { children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const { getSimDays } = useSimApi();
  useFrame(() => {
    if (!group.current) return;
    const [x, y, z] = sunBarycentricOffset(getSimDays());
    group.current.position.set(x, y, z);
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

  const followingRef = useRef(focusIsOrbiter(focusId));
  followingRef.current = focusIsOrbiter(focusId);
  const focusIdRef = useRef(focusId);
  focusIdRef.current = focusId;

  // Stable API object: memoized BodyMesh useFrame always calls fresh getters.
  const api = useRef<SimApi>({
    getSimDays: () => simDaysRef.current,
    getFollowing: () => followingRef.current,
    getFocusId: () => focusIdRef.current,
  }).current;

  return (
    <SimContext.Provider value={api}>
      {/* Clock + invalidate share one wall rAF — works idle and follow. */}
      <SimDriver active simDaysRef={simDaysRef} rateRef={rateRef} />
      {children}
    </SimContext.Provider>
  );
}

function SceneContent({ focusId, onSelect, highlightColor, simDaysPerSec }: Props) {
  // Orbit ellipses only for catalog heliocentric orbits — never the sun
  // (sun wobble is BarycentricRoot viz-only; no catalog OrbitLine).
  const orbiters = useMemo(
    () => bodies.filter((b) => b.orbit && b.kind !== "star"),
    [],
  );
  // Idle system view: no camera autoRotate (user orbits manually).
  // Follow mode still ride-alongs when a planet is selected.
  const invalidate = useThree((s) => s.invalidate);

  return (
    <SimProvider focusId={focusId} simDaysPerSec={simDaysPerSec}>
      <color attach="background" args={["#02040a"]} />
      <Starfield />
      <SoftHaze />
      <ambientLight intensity={0.32} />
      <BarycentricRoot>
        {/* pointLight lives on the sun BodyMesh so it follows barycentric wobble */}
        {orbiters.map((b) => (
          <OrbitLine
            key={`o-${b.id}`}
            body={b}
            highlighted={focusId === b.id}
            highlightColor={highlightColor}
          />
        ))}
        {bodies.map((b) => (
          <BodyMesh
            key={b.id}
            body={b}
            focused={focusId === b.id}
            onSelect={onSelect}
            highlightColor={highlightColor}
          />
        ))}
      </BarycentricRoot>
      <OrbitControls
        makeDefault
        enablePan
        enableZoom
        enableRotate
        autoRotate={false}
        minDistance={0.5}
        maxDistance={80}
        onChange={() => invalidate()}
      />
      <FollowCamera />
    </SimProvider>
  );
}

export function OrbitScene({ focusId, onSelect, highlightColor, simDaysPerSec }: Props) {
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
        camera={{ position: [0, 8, 14], fov: 45, near: 0.01, far: 250 }}
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
        />
      </Canvas>
    </div>
  );
}
