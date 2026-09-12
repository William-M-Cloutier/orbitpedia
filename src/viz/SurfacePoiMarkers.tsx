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
 * Geographic surface markers parented under the body's spin mesh so they
 * rotate with the texture. Shown only for the focused body.
 */
export const SurfacePoiMarkers = memo(function SurfacePoiMarkers({
  pois,
  radius,
  selectedPoiId,
  onSelectPoi,
}: Props) {
  const markerR = Math.max(radius * 0.035, 0.0018);
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
      <mesh onClick={handleClick} scale={selected ? 1.35 : 1}>
        <sphereGeometry args={[markerR, 12, 12]} />
        <meshBasicMaterial
          color={selected ? "#fbbf24" : "#38bdf8"}
          depthTest
          depthWrite
        />
      </mesh>
      {selected ? (
        <Html
          center
          distanceFactor={8}
          style={{ pointerEvents: "none", userSelect: "none" }}
          zIndexRange={[100, 0]}
        >
          <div className="whitespace-nowrap rounded-md border border-amber-400/40 bg-[#0a1220]/92 px-2 py-1 text-[11px] font-medium text-amber-100 shadow-lg backdrop-blur-sm">
            {poi.name}
          </div>
        </Html>
      ) : null}
    </group>
  );
});
