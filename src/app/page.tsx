"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/ui/AppShell";
import { BodyRail } from "@/components/ui/BodyRail";
import { FactsPanel } from "@/components/ui/FactsPanel";
import {
  DEFAULT_SPEED_PRESET,
  SpeedControl,
  multipleToDaysPerSec,
} from "@/components/ui/SpeedControl";
import { OrbitCanvas } from "@/viz/OrbitCanvas";
import { getBody } from "@/data/catalog";

function ExploreHome() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusParam = searchParams.get("focus");

  const [focusId, setFocusId] = useState<string | null>(null);
  const [speedMultiple, setSpeedMultiple] = useState(DEFAULT_SPEED_PRESET.multiple);
  const focus = focusId ? getBody(focusId) : undefined;
  const simDaysPerSec = useMemo(
    () => multipleToDaysPerSec(speedMultiple),
    [speedMultiple],
  );

  // Hydrate (and re-hydrate) from ?focus=
  useEffect(() => {
    if (focusParam) {
      setFocusId(getBody(focusParam) ? focusParam : null);
      return;
    }
    setFocusId(null);
  }, [focusParam]);

  const setFocus = useCallback(
    (id: string | null) => {
      setFocusId(id);
      if (id && getBody(id)) {
        router.replace(`/?focus=${encodeURIComponent(id)}`, { scroll: false });
      } else {
        router.replace("/", { scroll: false });
      }
    },
    [router],
  );

  // Viz (and UI) may clear via onSelect(null) — drops ?focus= and empties FactsPanel.
  const onSelect = useCallback(
    (id: string | null) => setFocus(id),
    [setFocus],
  );
  const onClear = useCallback(() => setFocus(null), [setFocus]);
  const onRailFocus = useCallback(
    (id: string) => setFocus(focusId === id ? null : id),
    [setFocus, focusId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setFocus]);


  return (
    <AppShell rail={<BodyRail activeId={focusId ?? undefined} onFocus={onRailFocus} />}>
      <div className="relative flex h-[calc(100vh-3.5rem)] flex-col md:flex-row">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
            <div>
              <h1 className="text-sm font-medium text-zinc-200">Explore</h1>
              <p className="text-xs text-zinc-500">
                Size tiers are schematic — not true scale. Click to follow;
                click again or right-click to clear; Esc also clears.
              </p>
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 flex-row">
            <div className="relative min-h-0 min-w-0 flex-1">
              <OrbitCanvas
                focusId={focusId}
                onSelect={onSelect}
                highlightColor={focus?.color}
                simDaysPerSec={simDaysPerSec}
              />
              <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex justify-start">
                <SpeedControl
                  multiple={speedMultiple}
                  onMultipleChange={setSpeedMultiple}
                />
              </div>
            </div>
            {/*
              Always reserve the Facts column on md+ so the WebGL canvas width
              (and optical center) stay stable whether or not a body is selected.
            */}
            <div className="pointer-events-none hidden w-72 shrink-0 border-l border-white/10 md:block lg:w-80">
              <div className="pointer-events-auto h-full">
                <FactsPanel body={focus} onClear={onClear} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export default function ExploreHomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center text-sm text-zinc-500">
          Loading Explore…
        </div>
      }
    >
      <ExploreHome />
    </Suspense>
  );
}
