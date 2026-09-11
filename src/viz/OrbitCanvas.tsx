"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

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
  highlightColor?: string;
  /** Simulated days advanced per real second (idle + follow). UI owns presets. */
  simDaysPerSec?: number;
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
