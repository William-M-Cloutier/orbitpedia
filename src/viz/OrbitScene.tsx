"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import {
  useMemo,
  useCallback,
  memo,
  useEffect,
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
  onSelect?: (id: string) => void;
  highlightColor?: string;
};

/** Wall-clock days advanced per real second while following (paused when hidden). */
const SIM_DAYS_PER_SEC = 6;

type SimApi = {
  /** Simulated days since follow started (or resumed). */
  getSimDays: () => number;
  following: boolean;
  focusId: string | null | undefined;
};

const SimContext = createContext<SimApi>({
  getSimDays: () => 0,
  following: false,
  focusId: null,
});

/** True only when focus refers to a body that has an orbit (not sun / not star). */
function focusIsOrbiter(focusId?: string | null): boolean {
  if (!focusId) return false;
  const b = bodies.find((x) => x.id === focusId);
  return Boolean(b?.orbit && b.kind !== "star");
}

function eclipticToScene(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y];
}

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

const sharedSunMat = new THREE.MeshBasicMaterial({ color: "#FDB813" });

function Starfield({ count = 3200 }: { count?: number }) {
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

  return (
    <points frustumCulled={false}>
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
  onSelect?: (id: string) => void;
  highlightColor?: string;
}) {
  const group = useRef<THREE.Group>(null);
  const { getSimDays, following } = useContext(SimContext);
  const r = visualRadius(body);
  const color = body.color ?? "#888";
  const accent = highlightColor ?? color;

  const handleClick = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onSelect?.(body.id);
    },
    [body.id, onSelect],
  );

  // Epoch pose when idle; sim clock while following.
  useEffect(() => {
    if (!group.current) return;
    if (following) return;
    const [x, y, z] = bodyPosition(body, 0);
    group.current.position.set(x, y, z);
  }, [body, following]);

  useFrame(() => {
    if (!group.current || !following) return;
    const [x, y, z] = bodyPosition(body, getSimDays());
    group.current.position.set(x, y, z);
  });

  if (body.kind === "star") {
    const sunRing = highlightColor ?? "#FDB813";
    return (
      <group ref={group}>
        <mesh
          onClick={handleClick}
          material={sharedSunMat}
          scale={focused ? 1.2 : 1}
        >
          <sphereGeometry args={[r, 32, 32]} />
        </mesh>
        {focused && (
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[r * 1.35, r * 1.55, 64]} />
            <meshBasicMaterial
              color={sunRing}
              transparent
              opacity={0.55}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        )}
      </group>
    );
  }

  return (
    <group ref={group}>
      <mesh onClick={handleClick} scale={focused ? 1.35 : 1}>
        <sphereGeometry args={[r, 24, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={focused ? accent : "#000000"}
          emissiveIntensity={focused ? 0.45 : 0}
        />
      </mesh>
      {focused && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r * 1.4, r * 1.65, 64]} />
          <meshBasicMaterial
            color={accent}
            transparent
            opacity={0.7}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
});

function FollowCamera() {
  const { getSimDays, following, focusId } = useContext(SimContext);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const invalidate = useThree((s) => s.invalidate);
  const target = useRef(new THREE.Vector3(0, 0, 0));
  const desired = useRef(new THREE.Vector3(0, 0, 0));
  const offset = useRef(new THREE.Vector3());

  // Snap / re-frame when focus changes (canned offset only on focus change).
  useEffect(() => {
    let pos: [number, number, number] = [0, 0, 0];
    let dist = 12;
    if (focusId && focusId !== "sun") {
      const b = bodies.find((x) => x.id === focusId);
      if (b?.orbit) {
        pos = bodyPosition(b, following ? getSimDays() : 0);
        dist = Math.max(1.2, b.orbit.aAu * 0.55 + 1.5);
      }
    }
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
    invalidate();
  }, [focusId, camera, controls, invalidate]); // eslint-disable-line react-hooks/exhaustive-deps -- snap on focus change only

  useFrame((_, delta) => {
    if (!following || !focusId) return;

    const b = bodies.find((x) => x.id === focusId);
    if (!b?.orbit) return;

    const pos = bodyPosition(b, getSimDays());
    desired.current.set(pos[0], pos[1], pos[2]);

    // Preserve user's relative camera offset; only slide the look-at target.
    if (controls?.target) {
      offset.current.copy(camera.position).sub(controls.target);
    } else {
      offset.current.copy(camera.position).sub(target.current);
    }

    const lerp = 1 - Math.exp(-4 * delta);
    target.current.lerp(desired.current, lerp);

    camera.position.copy(target.current).add(offset.current);
    if (controls?.target) {
      controls.target.copy(target.current);
      controls.update();
    } else {
      camera.lookAt(target.current);
    }
  });

  return null;
}

/** Keeps demand frameloop animating only while following. */
function FollowInvalidator({ following }: { following: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!following) return;
    let id = 0;
    const loop = () => {
      invalidate();
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [following, invalidate]);
  return null;
}

function SimProvider({
  focusId,
  children,
}: {
  focusId?: string | null;
  children: React.ReactNode;
}) {
  const following = focusIsOrbiter(focusId);
  const simDaysRef = useRef(0);
  const lastWallRef = useRef<number | null>(null);

  useEffect(() => {
    // Reset clock when selection changes so new body starts from epoch + 0
    simDaysRef.current = 0;
    lastWallRef.current = null;
  }, [focusId]);

  useEffect(() => {
    if (!following) {
      lastWallRef.current = null;
      return;
    }
    let id = 0;
    const tick = (now: number) => {
      if (typeof document !== "undefined" && document.hidden) {
        lastWallRef.current = null;
      } else if (lastWallRef.current != null) {
        const dt = (now - lastWallRef.current) / 1000;
        simDaysRef.current += dt * SIM_DAYS_PER_SEC;
      }
      lastWallRef.current = typeof document !== "undefined" && document.hidden
        ? null
        : now;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);

    const onVis = () => {
      if (document.hidden) lastWallRef.current = null;
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [following]);

  const api = useMemo<SimApi>(
    () => ({
      getSimDays: () => simDaysRef.current,
      following,
      focusId,
    }),
    [following, focusId],
  );

  return <SimContext.Provider value={api}>{children}</SimContext.Provider>;
}

function SceneContent({ focusId, onSelect, highlightColor }: Props) {
  const orbiters = useMemo(
    () => bodies.filter((b) => b.orbit && b.kind !== "star"),
    [],
  );
  const following = focusIsOrbiter(focusId);
  const invalidate = useThree((s) => s.invalidate);

  return (
    <SimProvider focusId={focusId}>
      <color attach="background" args={["#02040a"]} />
      <Starfield />
      <SoftHaze />
      <ambientLight intensity={0.32} />
      <pointLight position={[0, 0, 0]} intensity={2.2} distance={80} />
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
      <OrbitControls
        makeDefault
        enablePan
        minDistance={0.5}
        maxDistance={80}
        onChange={() => invalidate()}
      />
      <FollowCamera />
      <FollowInvalidator following={following} />
    </SimProvider>
  );
}

export function OrbitScene({ focusId, onSelect, highlightColor }: Props) {
  return (
    <div className="h-full w-full">
      <Canvas
        frameloop="demand"
        camera={{ position: [0, 8, 14], fov: 45, near: 0.01, far: 250 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onPointerMissed={() => {
          /* keep selection; Esc clears at page level */
        }}
      >
        <SceneContent
          focusId={focusId}
          onSelect={onSelect}
          highlightColor={highlightColor}
        />
      </Canvas>
    </div>
  );
}
