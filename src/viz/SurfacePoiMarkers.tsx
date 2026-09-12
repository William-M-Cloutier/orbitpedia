"use client";

import { memo, useCallback, useMemo } from "react";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { SurfacePoi } from "@/data/poiSchema";
import { latLonToLocal } from "@/lib/latLon";

type Props = {
  pois: readonly SurfacePoi[];
  /** Local sphere radius (matches BodyMesh sphereGeometry). */
  radius: number;
  selectedPoiId?: string | null;
  onSelectPoi?: (id: string | null) => void;
};

/**
 * Geographic surface markers parented under the body's spin mesh.
 * Focused body only. Labels: selected-only, occluded, finished callout.
 */
export const SurfacePoiMarkers = memo(function SurfacePoiMarkers({
  pois,
  radius,
  selectedPoiId,
  onSelectPoi,
}: Props) {
  const markerR = Math.max(radius * 0.026, 0.0014);
  const lift = radius * 1.02;

  const positions = useMemo(() => {
    return pois.map((p) => ({
      poi: p,
      pos: latLonToLocal(p.latDeg, p.lonDeg, lift),
    }));
  }, [pois, lift]);

  return (
    <group name="surface-pois">
      {positions.map(({ poi, pos }) => (
        <PoiMarker
          key={poi.id}
          poi={poi}
          position={pos}
          markerR={markerR}
          selected={selectedPoiId === poi.id}
          onSelectPoi={onSelectPoi}
        />
      ))}
    </group>
  );
});

const PoiMarker = memo(function PoiMarker({
  poi,
  position,
  markerR,
  selected,
  onSelectPoi,
}: {
  poi: SurfacePoi;
  position: THREE.Vector3;
  markerR: number;
  selected: boolean;
  onSelectPoi?: (id: string | null) => void;
}) {
  const handleClick = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onSelectPoi?.(selected ? null : poi.id);
    },
    [onSelectPoi, poi.id, selected],
  );

  return (
    <group position={position}>
      {selected ? (
        <mesh scale={2.15}>
          <sphereGeometry args={[markerR, 16, 16]} />
          <meshBasicMaterial
            color="#fbbf24"
            transparent
            opacity={0.28}
            depthTest
            depthWrite={false}
          />
        </mesh>
      ) : null}
      <mesh onClick={handleClick} scale={selected ? 1.15 : 1}>
        <sphereGeometry args={[markerR, 16, 16]} />
        <meshBasicMaterial
          color={selected ? "#fbbf24" : "#38bdf8"}
          depthTest
          depthWrite
        />
      </mesh>
      {selected ? (
        <Html
          center
          occlude
          distanceFactor={9}
          position={[0, markerR * 4.2, 0]}
          style={{ pointerEvents: "none", userSelect: "none" }}
          zIndexRange={[100, 0]}
        >
          <div className="flex flex-col items-center">
            <div className="max-w-[12rem] rounded-lg border border-amber-300/40 bg-[#0a1220]/96 px-2.5 py-1.5 text-center shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md">
              <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-amber-200/65">
                Place
              </p>
              <p className="mt-0.5 truncate text-[12px] font-semibold leading-snug tracking-tight text-amber-50">
                {poi.name}
              </p>
            </div>
            <div
              className="mt-0.5 h-2.5 w-px bg-gradient-to-b from-amber-300/50 to-amber-400/25"
              aria-hidden
            />
            <div
              className="h-0 w-0 border-x-[5px] border-x-transparent border-t-[6px] border-t-amber-300/55"
              aria-hidden
            />
          </div>
        </Html>
      ) : null}
    </group>
  );
});
