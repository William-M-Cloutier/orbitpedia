"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/ui/AppShell";
import { BodyRail } from "@/components/ui/BodyRail";
import { FactsPanel } from "@/components/ui/FactsPanel";
import {
  DEFAULT_SPEED_PRESET,
  EARTH_SATS_SPEED_MULTIPLE,
  SpeedControl,
  multipleToDaysPerSec,
} from "@/components/ui/SpeedControl";
import { OrbitCanvas } from "@/viz/OrbitCanvas";
import {
  EARTH_SATS_SYSTEM_ID,
  getBody,
  getHomeSystem,
  getSystemGraph,
} from "@/data/catalog";
import { getPoi } from "@/data/pois";
import { getSystemGraphAsync } from "@/data/archiveCatalog";
import {
  SizeModeControl,
  DEFAULT_SIZE_MODE,
} from "@/components/ui/SizeModeControl";
import type { SizeMode } from "@/viz/sizeTiers";

function ExploreHome() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusParam = searchParams.get("focus");
  const systemParam = searchParams.get("system");

  const homeId = getHomeSystem().id;
  const requestedSystemId = systemParam && systemParam.length > 0 ? systemParam : homeId;

  const [systemId, setSystemId] = useState<string>(homeId);
  const [graphReady, setGraphReady] = useState(false);

  // Prime curated sync or archive lazy graph before Explore renders the scene.
  useEffect(() => {
    let cancelled = false;
    setGraphReady(false);
    (async () => {
      try {
        await getSystemGraphAsync(requestedSystemId);
        if (cancelled) return;
        setSystemId(requestedSystemId);
        setGraphReady(true);
      } catch (err) {
        if (cancelled) return;
        // Unknown / failed archive → fall back to home.
        try {
          await getSystemGraphAsync(homeId);
        } catch {
          /* home must exist */
        }
        if (cancelled) return;
        setSystemId(homeId);
        setGraphReady(true);
        void err;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestedSystemId, homeId]);

  const system = useMemo(
    () => (graphReady ? getSystemGraph(systemId).system : getHomeSystem()),
    [graphReady, systemId],
  );
  const memberIds = useMemo(
    () =>
      graphReady
        ? new Set(getSystemGraph(systemId).bodies.map((b) => b.id))
        : new Set<string>(),
    [graphReady, systemId],
  );

  const [focusId, setFocusId] = useState<string | null>(null);
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [speedMultiple, setSpeedMultiple] = useState(DEFAULT_SPEED_PRESET.multiple);
  const [sizeMode, setSizeMode] = useState<SizeMode>(DEFAULT_SIZE_MODE);
  /** Session-only — never written to catalog JSON. Cleared on system switch. */
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const focus = focusId ? getBody(focusId) : undefined;
  const selectedPoi = selectedPoiId ? getPoi(selectedPoiId) : undefined;
  const simDaysPerSec = useMemo(
    () => multipleToDaysPerSec(speedMultiple),
    [speedMultiple],
  );

  const isHome = systemId === homeId;
  const isEarthSats = systemId === EARTH_SATS_SYSTEM_ID;

  // Drop session hide set when leaving a system (no leftover filters).
  useEffect(() => {
    setHiddenIds(new Set());
  }, [systemId]);

  // Earth sats: 1 day / 60s wall (not Sol Default). Slow remains a user option.
  useEffect(() => {
    setSpeedMultiple(
      systemId === EARTH_SATS_SYSTEM_ID
        ? EARTH_SATS_SPEED_MULTIPLE
        : DEFAULT_SPEED_PRESET.multiple,
    );
  }, [systemId]);

  // Hydrate (and re-hydrate) from ?system=&focus=
  useEffect(() => {
    if (focusParam && memberIds.has(focusParam) && getBody(focusParam)) {
      setFocusId(focusParam);
      return;
    }
    setFocusId(null);
    setSelectedPoiId(null);
  }, [focusParam, memberIds]);

  const pushExplore = useCallback(
    (nextSystemId: string, nextFocus: string | null) => {
      const params = new URLSearchParams();
      if (nextSystemId !== homeId) {
        params.set("system", nextSystemId);
      }
      if (nextFocus && getBody(nextFocus)) {
        params.set("focus", nextFocus);
      }
      const qs = params.toString();
      router.replace(qs ? `/?${qs}` : "/", { scroll: false });
    },
    [router, homeId],
  );

  const setFocus = useCallback(
    (id: string | null) => {
      const next =
        id && memberIds.has(id) && getBody(id) ? id : null;
      setFocusId(next);
      setSelectedPoiId(null);
      pushExplore(systemId, next);
    },
    [memberIds, pushExplore, systemId],
  );

  const goHome = useCallback(() => {
    setFocusId(null);
    setSelectedPoiId(null);
    setHiddenIds(new Set());
    router.replace("/", { scroll: false });
  }, [router]);

  // Viz (and UI) may clear via onSelect(null) — drops ?focus= and empties FactsPanel.
  const onSelect = useCallback(
    (id: string | null) => setFocus(id),
    [setFocus],
  );
  const onClear = useCallback(() => setFocus(null), [setFocus]);
  const onSelectPoi = useCallback((id: string | null) => {
    setSelectedPoiId(id);
  }, []);
  const onClearPoi = useCallback(() => setSelectedPoiId(null), []);
  const onRailFocus = useCallback(
    (id: string) => setFocus(focusId === id ? null : id),
    [setFocus, focusId],
  );

  const onToggleHidden = useCallback(
    (id: string) => {
      const willHide = !hiddenIds.has(id);
      setHiddenIds((prev) => {
        const next = new Set(prev);
        if (willHide) next.add(id);
        else next.delete(id);
        return next;
      });
      if (willHide && focusId === id) setFocus(null);
    },
    [hiddenIds, focusId, setFocus],
  );

  useEffect(() => {
    if (
      selectedPoiId &&
      (!focusId || getPoi(selectedPoiId)?.bodyId !== focusId)
    ) {
      setSelectedPoiId(null);
    }
  }, [focusId, selectedPoiId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectedPoiId) {
        setSelectedPoiId(null);
        return;
      }
      setFocus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setFocus, selectedPoiId]);

  if (!graphReady) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center text-sm text-zinc-500">
        Loading system…
      </div>
    );
  }

  return (
    <AppShell
      rail={
        <BodyRail
          systemId={systemId}
          activeId={focusId ?? undefined}
          onFocus={onRailFocus}
          hiddenIds={hiddenIds}
          onToggleHidden={onToggleHidden}
        />
      }
    >
      <div className="relative flex h-[calc(100vh-3.5rem)] flex-col md:flex-row">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
            <div>
              <h1 className="text-sm font-medium text-zinc-200">
                Explore
                <span className="ml-2 font-normal text-zinc-500">
                  · {system.name}
                </span>
              </h1>
              <p className="text-xs text-zinc-500">
                Click to follow; click again or right-click to clear; Esc also
                clears.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href="/systems"
                className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10 hover:text-zinc-100"
              >
                Systems
              </Link>
              {!isHome ? (
                <button
                  type="button"
                  onClick={goHome}
                  className="rounded-md border border-sky-500/30 bg-sky-500/15 px-2.5 py-1 text-xs text-sky-200 hover:bg-sky-500/25"
                  title="Return to Solar System"
                >
                  Home
                </button>
              ) : null}
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 flex-row">
            <div className="relative min-h-0 min-w-0 flex-1">
              {/* key remounts Canvas — unload RAF / meshes on system switch */}
              <OrbitCanvas
                key={systemId}
                systemId={systemId}
                focusId={focusId}
                onSelect={onSelect}
                selectedPoiId={selectedPoiId}
                onSelectPoi={onSelectPoi}
                highlightColor={focus?.color}
                simDaysPerSec={simDaysPerSec}
                sizeMode={sizeMode}
                hiddenIds={hiddenIds}
              />
              <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col gap-2 items-start">
                {!isEarthSats ? (

                  <SizeModeControl mode={sizeMode} onModeChange={setSizeMode} />

                ) : null}
                <SpeedControl
                  multiple={speedMultiple}
                  onMultipleChange={setSpeedMultiple}
                  highlightNearestPreset={!isEarthSats}
                />
              </div>
            </div>
            {/*
              Always reserve the Facts column on md+ so the WebGL canvas width
              (and optical center) stay stable whether or not a body is selected.
            */}
            <div className="pointer-events-none hidden w-72 shrink-0 border-l border-white/10 md:block lg:w-80">
              <div className="pointer-events-auto h-full">
                <FactsPanel
                  body={focus}
                  system={system}
                  onClear={onClear}
                  selectedPoi={selectedPoi}
                  onClearPoi={onClearPoi}
                />
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
