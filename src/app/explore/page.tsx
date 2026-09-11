"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/ui/AppShell";
import { BodyRail } from "@/components/ui/BodyRail";
import { OrbitCanvas } from "@/viz/OrbitCanvas";
import { getBody } from "@/data/catalog";

export default function ExplorePage() {
  const [focusId, setFocusId] = useState<string>("sun");
  const focus = getBody(focusId);

  const onSelect = useCallback((id: string) => setFocusId(id), []);

  return (
    <AppShell
      rail={<BodyRail activeId={focusId} onFocus={onSelect} />}
    >
      <div className="flex h-[calc(100vh-3.5rem)] flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
          <div>
            <h1 className="text-sm font-medium text-zinc-200">Explore</h1>
            <p className="text-xs text-zinc-500">
              Size tiers are schematic — not true scale. Click a body to focus.
            </p>
          </div>
          {focus && (
            <Link
              href={`/body/${focus.id}`}
              className="rounded-md bg-sky-500/20 px-3 py-1.5 text-sm text-sky-200 hover:bg-sky-500/30"
            >
              {focus.name} details →
            </Link>
          )}
        </div>
        <div className="min-h-0 flex-1">
          <OrbitCanvas focusId={focusId} onSelect={onSelect} />
        </div>
      </div>
    </AppShell>
  );
}
