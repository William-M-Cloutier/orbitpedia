"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/ui/AppShell";
import { BodyRail } from "@/components/ui/BodyRail";
import { FactsPanel } from "@/components/ui/FactsPanel";
import { OrbitCanvas } from "@/viz/OrbitCanvas";
import { getBody } from "@/data/catalog";

function ExploreHome() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusParam = searchParams.get("focus");

  const [focusId, setFocusId] = useState<string | null>(null);
  const focus = focusId ? getBody(focusId) : undefined;

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

  const onSelect = useCallback((id: string) => setFocus(id), [setFocus]);
  const onClear = useCallback(() => setFocus(null), [setFocus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setFocus]);

  return (
    <AppShell rail={<BodyRail activeId={focusId ?? undefined} onFocus={onSelect} />}>
      <div className="relative flex h-[calc(100vh-3.5rem)] flex-col md:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
            <div>
              <h1 className="text-sm font-medium text-zinc-200">Explore</h1>
              <p className="text-xs text-zinc-500">
                Size tiers are schematic — not true scale. Click a body to
                follow; Esc clears.
              </p>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <OrbitCanvas focusId={focusId} onSelect={onSelect} />
          </div>
        </div>
        <FactsPanel body={focus} onClear={onClear} />
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
