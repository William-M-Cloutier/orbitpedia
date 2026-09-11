"use client";

import { Suspense, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/ui/AppShell";
import { BodyRail } from "@/components/ui/BodyRail";
import {
  getBodiesForSystem,
  getHomeSystem,
  getSystem,
  KIND_LABEL,
  listSystems,
} from "@/data/catalog";

function SearchInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const homeId = getHomeSystem().id;
  const systems = listSystems();

  const systemId = useMemo(() => {
    const p = searchParams.get("system");
    if (p && getSystem(p)) return p;
    return homeId;
  }, [searchParams, homeId]);

  const systemBodies = useMemo(
    () => getBodiesForSystem(systemId),
    [systemId],
  );
  const system = getSystem(systemId);

  const setSystem = useCallback(
    (id: string) => {
      const params = new URLSearchParams();
      if (id !== homeId) params.set("system", id);
      const qs = params.toString();
      router.replace(qs ? `/search?${qs}` : "/search", { scroll: false });
    },
    [router, homeId],
  );

  return (
    <AppShell rail={<BodyRail systemId={systemId} />}>
      <div className="mx-auto max-w-6xl space-y-8 p-6">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            Search
          </h1>
          <p className="mt-2 max-w-2xl text-zinc-400">
            Browse catalog bodies by system. Use the top-bar typeahead or pick
            below. Switch to{" "}
            <Link
              href={
                systemId === homeId
                  ? "/discover"
                  : `/discover?system=${encodeURIComponent(systemId)}`
              }
              className="text-sky-400 hover:underline"
            >
              Discover
            </Link>{" "}
            to compare, or{" "}
            <Link
              href={
                systemId === homeId
                  ? "/"
                  : `/?system=${encodeURIComponent(systemId)}`
              }
              className="text-sky-400 hover:underline"
            >
              Explore
            </Link>{" "}
            for lightweight 3D orbits.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {systems.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSystem(s.id)}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  s.id === systemId
                    ? "bg-sky-500/25 text-sky-100"
                    : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
          {system?.blurb ? (
            <p className="mt-3 max-w-2xl text-sm text-zinc-500">{system.blurb}</p>
          ) : null}
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {systemBodies.map((b) => (
            <Link
              key={b.id}
              href={`/body/${b.id}`}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-sky-500/30 hover:bg-sky-500/5"
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ background: b.color ?? "#888" }}
              />
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-100">{b.name}</p>
                <p className="text-xs text-zinc-500">{KIND_LABEL[b.kind]}</p>
              </div>
            </Link>
          ))}
        </section>
      </div>
    </AppShell>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-zinc-500">Loading Search…</div>
      }
    >
      <SearchInner />
    </Suspense>
  );
}
