"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import { useMemo, useCallback, memo, useEffect } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { bodies } from "@/data/catalog";
import type { Body } from "@/data/schema";
import { positionAtMa, sampleOrbit } from "@/lib/kepler";
import { visualRadius } from "./sizeTiers";

type Props = {
  focusId?: string;
  onSelect?: (id: string) => void;
};

const sharedSunMat = new THREE.MeshBasicMaterial({ color: "#FDB813" });

function eclipticToScene(x: number, y: number, z: number): [number, number, number] {
  // Map ecliptic XY to scene XZ (Y up)
  return [x, z, -y];
}

const OrbitLine = memo(function OrbitLine({ body }: { body: Body }) {
  const points = useMemo(() => {
    if (!body.orbit) return null;
    return sampleOrbit(body.orbit, 96).map(([x, y, z]) => {
      const [sx, sy, sz] = eclipticToScene(x, y, z);
      return new THREE.Vector3(sx, sy, sz);
    });
  }, [body.orbit]);

  if (!points) return null;
  return (
    <Line
      points={points}
      color={body.color ?? "#666"}
      lineWidth={1}
      transparent
      opacity={0.45}
    />
  );
});

const BodyMesh = memo(function BodyMesh({
  body,
  focused,
  onSelect,
}: {
  body: Body;
  focused: boolean;
  onSelect?: (id: string) => void;
}) {
  const pos = useMemo((): [number, number, number] => {
    if (body.kind === "star" || !body.orbit) return [0, 0, 0];
    const [x, y, z] = positionAtMa(body.orbit);
    return eclipticToScene(x, y, z);
  }, [body]);

  const r = visualRadius(body);
  const color = body.color ?? "#888";

  const handleClick = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onSelect?.(body.id);
    },
    [body.id, onSelect],
  );

  if (body.kind === "star") {
    return (
      <mesh position={[0, 0, 0]} onClick={handleClick} material={sharedSunMat}>
        <sphereGeometry args={[r, 32, 32]} />
      </mesh>
    );
  }

  return (
    <mesh position={pos} onClick={handleClick} scale={focused ? 1.35 : 1}>
      <sphereGeometry args={[r, 24, 24]} />
      <meshStandardMaterial
        color={color}
        emissive={focused ? color : "#000000"}
        emissiveIntensity={focused ? 0.35 : 0}
      />
    </mesh>
  );
});

function FocusCamera({ focusId }: { focusId?: string }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    let target: [number, number, number] = [0, 0, 0];
    let dist = 12;
    if (focusId && focusId !== "sun") {
      const b = bodies.find((x) => x.id === focusId);
      if (b?.orbit) {
        const [x, y, z] = positionAtMa(b.orbit);
        target = eclipticToScene(x, y, z);
        dist = Math.max(1.2, b.orbit.aAu * 0.55 + 1.5);
      }
    }
    camera.position.set(target[0] + dist * 0.6, dist * 0.45, target[2] + dist * 0.7);
    camera.lookAt(target[0], target[1], target[2]);
    if (controls?.target) {
      controls.target.set(target[0], target[1], target[2]);
      controls.update();
    }
    invalidate();
  }, [focusId, camera, controls, invalidate]);

  return null;
}

function SceneContent({ focusId, onSelect }: Props) {
  const orbiters = useMemo(
    () => bodies.filter((b) => b.orbit && b.kind !== "star"),
    [],
  );

  return (
    <>
      <color attach="background" args={["#03060c"]} />
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 0, 0]} intensity={2.2} distance={80} />
      {orbiters.map((b) => (
        <OrbitLine key={`o-${b.id}`} body={b} />
      ))}
      {bodies.map((b) => (
        <BodyMesh
          key={b.id}
          body={b}
          focused={focusId === b.id}
          onSelect={onSelect}
        />
      ))}
      <OrbitControls makeDefault enablePan minDistance={0.5} maxDistance={80} />
      <FocusCamera focusId={focusId} />
    </>
  );
}

export function OrbitScene({ focusId, onSelect }: Props) {
  return (
    <div className="h-full w-full">
      <Canvas
        frameloop="demand"
        camera={{ position: [0, 8, 14], fov: 45, near: 0.01, far: 200 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <SceneContent focusId={focusId} onSelect={onSelect} />
      </Canvas>
    </div>
  );
}
