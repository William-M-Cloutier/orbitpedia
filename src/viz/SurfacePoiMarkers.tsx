"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { SurfacePoi } from "@/data/poiSchema";
import { latLonToLocal } from "@/lib/latLon";

const Y_UP = new THREE.Vector3(0, 1, 0);

/** Default (unselected) pin — sky cyan, readable on marquee Earth. */
const COLOR_DEFAULT = "#38bdf8";
/** Selected pin head + ring — warmer amber accent. */
const COLOR_SELECTED = "#fbbf24";
const COLOR_RING = "#f59e0b";

type Props = {
  pois: readonly SurfacePoi[];
  /** Local sphere radius (matches BodyMesh sphereGeometry). */
  radius: number;
  selectedPoiId?: string | null;
  onSelectPoi?: (id: string | null) => void;
};

/**
 * Geographic surface markers parented under the body's spin mesh.
 * Focused body only. Mesh: pin/stem + head; selected ring; hover emissive.
 * Labels: selected-only Html callout (Sky UI), occluded, finished chrome.
 */
export const SurfacePoiMarkers = memo(function SurfacePoiMarkers({
  pois,
  radius,
  selectedPoiId,
  onSelectPoi,
}: Props) {
  /** Visible pin scale — keep lean; clickability comes from invisible hit volume. */
  const markerR = Math.max(radius * 0.026, 0.0014);
  /** Place pin base just above the sphere so the stem reads radially out. */
  const lift = radius * 1.012;

  const positions = useMemo(() => {
    return pois.map((p) => ({
      poi: p,
      pos: latLonToLocal(p.latDeg, p.lonDeg, lift),
    }));
  }, [pois, lift]);

  /** Shared materials for non-hover parts (~8/body — no instancing needed). */
  const shared = useMemo(() => {
    const stemDefault = new THREE.MeshBasicMaterial({
      color: COLOR_DEFAULT,
      transparent: true,
      opacity: 0.88,
      depthTest: true,
      depthWrite: true,
    });
    const stemSelected = new THREE.MeshBasicMaterial({
      color: COLOR_SELECTED,
      transparent: true,
      opacity: 0.92,
      depthTest: true,
      depthWrite: true,
    });
    const ring = new THREE.MeshBasicMaterial({
      color: COLOR_RING,
      transparent: true,
      opacity: 0.78,
      depthTest: true,
      depthWrite: false,
    });
    return { stemDefault, stemSelected, ring };
  }, []);

  useEffect(() => {
    return () => {
      shared.stemDefault.dispose();
      shared.stemSelected.dispose();
      shared.ring.dispose();
    };
  }, [shared]);

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
          shared={shared}
        />
      ))}
    </group>
  );
});

type SharedMats = {
  stemDefault: THREE.MeshBasicMaterial;
  stemSelected: THREE.MeshBasicMaterial;
  ring: THREE.MeshBasicMaterial;
};

const PoiMarker = memo(function PoiMarker({
  poi,
  position,
  markerR,
  selected,
  onSelectPoi,
  shared,
}: {
  poi: SurfacePoi;
  position: THREE.Vector3;
  markerR: number;
  selected: boolean;
  onSelectPoi?: (id: string | null) => void;
  shared: SharedMats;
}) {
  const [hovered, setHovered] = useState(false);
  const invalidate = useThree((s) => s.invalidate);

  const handleClick = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onSelectPoi?.(selected ? null : poi.id);
    },
    [onSelectPoi, poi.id, selected],
  );

  const onOver = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      setHovered(true);
      invalidate();
    },
    [invalidate],
  );

  const onOut = useCallback(() => {
    setHovered(false);
    invalidate();
  }, [invalidate]);

  /** Orient local +Y radially outward so the pin stands off the surface. */
  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion();
    const dir = position.clone().normalize();
    if (dir.lengthSq() < 1e-12) return q;
    q.setFromUnitVectors(Y_UP, dir);
    return q;
  }, [position]);

  const stemH = markerR * 2.6;
  const stemR = markerR * 0.2;
  const headR = markerR * (selected ? 1.05 : 0.88);
  const headY = stemH + headR * 0.75;
  /** Invisible click proxy — generous around head/stem without visual clutter. */
  const hitR = markerR * 3.6;
  const hitY = headY * 0.55;

  const headColor = selected ? COLOR_SELECTED : COLOR_DEFAULT;
  const emissiveIntensity = hovered
    ? selected
      ? 1.15
      : 0.9
    : selected
      ? 0.55
      : 0.32;
  const headOpacity = hovered ? 1 : 0.96;

  return (
    <group position={position} quaternion={quaternion}>
      {/* Invisible hit volume — easy to click; keeps visible pin clean */}
      <mesh
        position={[0, hitY, 0]}
        onClick={handleClick}
        onPointerOver={onOver}
        onPointerOut={onOut}
      >
        <sphereGeometry args={[hitR, 12, 12]} />
        <meshBasicMaterial
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>

      {/* Stem — thin cylinder along outward normal */}
      <mesh
        position={[0, stemH * 0.5, 0]}
        material={selected ? shared.stemSelected : shared.stemDefault}
        onClick={handleClick}
        onPointerOver={onOver}
        onPointerOut={onOut}
      >
        <cylinderGeometry args={[stemR, stemR * 1.2, stemH, 8]} />
      </mesh>

      {/* Head — sphere; amber when selected; emissive/opacity bump on hover */}
      <mesh
        position={[0, headY, 0]}
        scale={hovered ? 1.08 : 1}
        onClick={handleClick}
        onPointerOver={onOver}
        onPointerOut={onOut}
      >
        <sphereGeometry args={[headR, 16, 16]} />
        <meshStandardMaterial
          color={headColor}
          emissive={headColor}
          emissiveIntensity={emissiveIntensity}
          roughness={0.42}
          metalness={0.12}
          transparent
          opacity={headOpacity}
          depthTest
          depthWrite
        />
      </mesh>

      {/* Selected: thin torus ring around the pin head */}
      {selected ? (
        <mesh
          position={[0, headY, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          material={shared.ring}
          onClick={handleClick}
          onPointerOver={onOver}
          onPointerOut={onOut}
        >
          <torusGeometry args={[headR * 1.7, headR * 0.16, 8, 28]} />
        </mesh>
      ) : null}

      {/* Selected-only name chip: screen-stable (no distanceFactor) so zoom never balloons it.
          Bottom-anchored so caret tip sits on/near the pin head. */}
      {selected ? (
        <Html
          occlude
          position={[0, headY + headR * 0.15, 0]}
          style={{ pointerEvents: "none", userSelect: "none" }}
          zIndexRange={[100, 0]}
        >
          <div
            className="flex flex-col items-center"
            style={{ transform: "translate(-50%, -100%)" }}
          >
            <div className="max-w-[9rem] rounded-md border border-amber-300/40 bg-[#0a1220]/96 px-1.5 py-0.5 text-center shadow-[0_6px_16px_rgba(0,0,0,0.4)] backdrop-blur-md">
              <p className="truncate text-[11px] font-semibold leading-tight tracking-tight text-amber-50">
                {poi.name}
              </p>
            </div>
            {/* Short stem + caret — tip at Html anchor / pin head */}
            <div
              className="h-1 w-px bg-gradient-to-b from-amber-300/50 to-amber-400/25"
              aria-hidden
            />
            <div
              className="h-0 w-0 border-x-[4px] border-x-transparent border-t-[5px] border-t-amber-300/55"
              aria-hidden
            />
          </div>
        </Html>
      ) : null}
    </group>
  );
});
