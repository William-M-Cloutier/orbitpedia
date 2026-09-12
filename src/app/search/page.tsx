"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/ui/AppShell";
import { BodyRail } from "@/components/ui/BodyRail";
import {
  exploreHref,
  exploreSystemHref,
  getHomeSystem,
  getSystem,
  KIND_LABEL,
  KIND_ORDER,
  listSystems,
  isFixtureSystemId,
  searchCatalog,
  type CatalogSearchResult,
} from "@/data/catalog";
import {
  loadRecentSearches,
  pushRecentSearch,
  type RecentSearchItem,
} from "@/lib/recentSearches";
import type { Body, BodyKind, System } from "@/data/schema";

type FlatHit =
  | { key: string; type: "system"; system: System; href: string }
  | { key: string; type: "body"; body: Body; href: string };

function flattenGrouped(result: CatalogSearchResult): FlatHit[] {
  const out: FlatHit[] = [];
  for (const s of result.systems) {
    out.push({
      key: `sys:${s.id}`,
      type: "system",
      system: s,
      href: exploreSystemHref(s.id),
    });
  }
  const byKind = new Map<BodyKind, Body[]>();
  for (const b of result.bodies) {
    const list = byKind.get(b.kind) ?? [];
    list.push(b);
    byKind.set(b.kind, list);
  }
  for (const kind of KIND_ORDER) {
    const list = byKind.get(kind);
    if (!list) continue;
    for (const b of list) {
      out.push({
        key: `body:${b.id}`,
        type: "body",
        body: b,
        href: exploreHref(b.id, b.systemId),
      });
    }
  }
  return out;
}

function SearchInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const homeId = getHomeSystem().id;
  const inputRef = useRef<HTMLInputElement>(null);

  const initialQ = searchParams.get("q") ?? "";
  const [q, setQ] = useState(initialQ);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<RecentSearchItem[]>([]);

  useEffect(() => {
    setRecent(loadRecentSearches());
  }, []);

  // Sync from ?q= (e.g. TopBar "no hits" handoff).
  useEffect(() => {
    const param = searchParams.get("q") ?? "";
    setQ(param);
  }, [searchParams]);

  const result = useMemo(() => searchCatalog(q), [q]);
  const hits = useMemo(() => flattenGrouped(result), [result]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  const systemsForChips = useMemo(
    () => listSystems().filter((s) => !isFixtureSystemId(s.id)),
    [],
  );

  const go = useCallback(
    (hit: FlatHit) => {
      const label = hit.type === "system" ? hit.system.name : hit.body.name;
      pushRecentSearch({ label, href: hit.href, kind: hit.type });
      setRecent(loadRecentSearches());
      router.push(hit.href);
    },
    [router],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!hits.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % hits.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + hits.length) % hits.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const hit = hits[active] ?? hits[0];
        if (hit) go(hit);
      }
    },
    [hits, active, go],
  );

  const setQuery = useCallback(
    (next: string) => {
      setQ(next);
      const params = new URLSearchParams();
      if (next.trim()) params.set("q", next.trim());
      const qs = params.toString();
      router.replace(qs ? `/search?${qs}` : "/search", { scroll: false });
    },
    [router],
  );

  const hasQuery = q.trim().length > 0;
  const empty = hasQuery && hits.length === 0;

  // Bodies grouped for section headers.
  const bodiesByKind = useMemo(() => {
    const map = new Map<BodyKind, Body[]>();
    for (const b of result.bodies) {
      const list = map.get(b.kind) ?? [];
      list.push(b);
      map.set(b.kind, list);
    }
    return KIND_ORDER.filter((k) => map.has(k)).map((k) => ({
      kind: k,
      bodies: map.get(k)!,
    }));
  }, [result.bodies]);

  return (
    <AppShell rail={<BodyRail systemId={homeId} />}>
      <div className="mx-auto max-w-3xl space-y-8 p-6">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            Search
          </h1>
          <p className="mt-2 max-w-2xl text-zinc-400">
            Find a system or body, then open Explore. Compare and charts live on{" "}
            <Link href="/discover" className="text-sky-400 hover:underline">
              Discover
            </Link>
            .
          </p>
          <div className="mt-4">
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Try Sol, Earth, TRAPPIST…"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-sky-500/50"
              aria-label="Search systems and bodies"
              autoFocus
            />
            <p className="mt-2 text-xs text-zinc-500">
              ↑↓ to move · Enter opens Explore
            </p>
          </div>
        </section>

        {!hasQuery && recent.length > 0 && (
          <section>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Recent
            </h2>
            <ul className="divide-y divide-white/5 rounded-xl border border-white/10">
              {recent.map((r) => (
                <li key={r.href}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-white/5"
                    onClick={() => {
                      pushRecentSearch(r);
                      router.push(r.href);
                    }}
                  >
                    <span className="text-zinc-100">{r.label}</span>
                    <span className="text-xs text-zinc-500">
                      {r.kind === "system" ? "System" : "Body"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!hasQuery && (
          <section>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Systems
            </h2>
            <div className="flex flex-wrap gap-2">
              {systemsForChips.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    const href = exploreSystemHref(s.id);
                    pushRecentSearch({
                      label: s.name,
                      href,
                      kind: "system",
                    });
                    router.push(href);
                  }}
                  className="rounded-lg bg-white/5 px-3 py-1.5 text-sm text-zinc-300 hover:bg-sky-500/15 hover:text-sky-100"
                >
                  {s.name}
                </button>
              ))}
            </div>
          </section>
        )}

        {empty && (
          <p className="text-sm text-zinc-500">
            No matches for &ldquo;{q.trim()}&rdquo;.
          </p>
        )}

        {hasQuery && result.systems.length > 0 && (
          <section>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Systems
            </h2>
            <ul className="divide-y divide-white/5 rounded-xl border border-white/10">
              {result.systems.map((s) => {
                const hit = hits.find(
                  (h) => h.type === "system" && h.system.id === s.id,
                )!;
                const idx = hits.indexOf(hit);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm ${
                        idx === active
                          ? "bg-sky-500/15"
                          : "hover:bg-white/5"
                      }`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => go(hit)}
                    >
                      <span className="font-medium text-zinc-100">{s.name}</span>
                      <span className="text-xs text-zinc-500">Explore</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {hasQuery &&
          bodiesByKind.map(({ kind, bodies: group }) => (
            <section key={kind}>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                {KIND_LABEL[kind]}s
              </h2>
              <ul className="divide-y divide-white/5 rounded-xl border border-white/10">
                {group.map((b) => {
                  const hit = hits.find(
                    (h) => h.type === "body" && h.body.id === b.id,
                  )!;
                  const idx = hits.indexOf(hit);
                  const sys = getSystem(b.systemId);
                  return (
                    <li key={b.id}>
                      <div
                        className={`flex items-center gap-2 px-4 py-2.5 ${
                          idx === active ? "bg-sky-500/15" : "hover:bg-white/5"
                        }`}
                        onMouseEnter={() => setActive(idx)}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-3 text-left text-sm"
                          onClick={() => go(hit)}
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ background: b.color ?? "#888" }}
                          />
                          <span className="min-w-0 truncate font-medium text-zinc-100">
                            {b.name}
                          </span>
                          <span className="shrink-0 rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400">
                            {sys?.name ?? b.systemId}
                          </span>
                        </button>
                        <Link
                          href={`/body/${b.id}`}
                          className="shrink-0 text-xs text-zinc-500 hover:text-sky-400"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Card
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
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
