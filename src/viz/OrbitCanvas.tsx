"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import type { BodyKind } from "@/data/schema";
import type { SizeMode } from "./sizeTiers";

const OrbitScene = dynamic(
  () => import("./OrbitScene").then((m) => m.OrbitScene),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Loading 3D scene…
      </div>
    ),
  },
);

type Props = {
  focusId?: string | null;
  onSelect?: (id: string | null) => void;
  selectedPoiId?: string | null;
  onSelectPoi?: (id: string | null) => void;
  highlightColor?: string;
  /** Simulated days advanced per real second (idle + follow). UI owns presets. */
  simDaysPerSec?: number;
  sizeMode?: SizeMode;
  /** Session-only ids with mesh + orbit line suppressed (Explore hide). */
  hiddenIds?: ReadonlySet<string>;
  /** Body kinds whose OrbitLine / ProbePathLine are hidden (moons inherit planet). */
  hideOrbitPathKinds?: ReadonlySet<BodyKind>;
  /** Body kinds whose meshes/markers are hidden (moons inherit planet). */
  hideMeshKinds?: ReadonlySet<BodyKind>;
  /** @deprecated Prefer hideOrbitPathKinds.has("probe"). */
  hideProbePaths?: boolean;
  /** @deprecated Prefer hideMeshKinds.has("probe"). */
  hideProbeMeshes?: boolean;
  /** Active system graph — remount parent with key={systemId} to unload RAF/meshes. */
  systemId?: string;
  /** Canvas-space overlay insets for setViewOffset (see OrbitScene). */
  viewInsetLeft?: number;
  viewInsetRight?: number;
};

export function OrbitCanvas(props: Props) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-zinc-500">
          Loading…
        </div>
      }
    >
      <OrbitScene {...props} />
    </Suspense>
  );
}
