"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/ui/AppShell";
import { BodyRail } from "@/components/ui/BodyRail";
import { FactsPanel } from "@/components/ui/FactsPanel";
import { OrbitCanvas } from "@/viz/OrbitCanvas";
import { getBody } from "@/data/catalog";

export default function ExploreHomePage() {
  const [focusId, setFocusId] = useState<string | null>(null);
  const focus = focusId ? getBody(focusId) : undefined;

  const onSelect = useCallback((id: string) => setFocusId(id), []);
  const onClear = useCallback(() => setFocusId(null), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocusId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
