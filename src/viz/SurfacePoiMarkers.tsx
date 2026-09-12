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
 * Labels: selected only, occluded by the globe, offset callout (not on-dot).
 */
export const SurfacePoiMarkers = memo(function SurfacePoiMarkers({
  pois,
  radius,
  selectedPoiId,
  onSelectPoi,
}: Props) {
  const markerR = Math.max(radius * 0.028, 0.0015);
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
      <mesh onClick={handleClick} scale={selected ? 1.25 : 1}>
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
          occlude
          distanceFactor={10}
          position={[0, markerR * 3.2, 0]}
          style={{ pointerEvents: "none", userSelect: "none" }}
          zIndexRange={[100, 0]}
        >
          <div className="flex flex-col items-center">
            <div className="max-w-[11rem] truncate rounded-md border border-amber-400/35 bg-[#0a1220]/95 px-2 py-1 text-center text-[11px] font-medium leading-tight text-amber-50 shadow-lg backdrop-blur-sm">
              {poi.name}
            </div>
            {/* Caret toward the marker */}
            <div
              className="h-0 w-0 border-x-[5px] border-x-transparent border-t-[6px] border-t-amber-400/50"
              aria-hidden
            />
          </div>
        </Html>
      ) : null}
    </group>
  );
});
