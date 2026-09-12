"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  exploreHref,
  exploreSystemHref,
  getSystem,
  KIND_LABEL,
  searchCatalog,
  type CatalogSearchResult,
} from "@/data/catalog";
import { pushRecentSearch } from "@/lib/recentSearches";

const MODES = [
  { href: "/", label: "Explore" },
  { href: "/systems", label: "Systems" },
  { href: "/discover", label: "Discover" },
  { href: "/search", label: "Search" },
] as const;

const TYPEAHEAD_CAP = 10;

type FlatHit =
  | { key: string; type: "system"; id: string; label: string; href: string }
  | {
      key: string;
      type: "body";
      id: string;
      label: string;
      href: string;
      kindLabel: string;
      systemName: string;
    };

function flattenHits(result: CatalogSearchResult, cap: number): FlatHit[] {
  const out: FlatHit[] = [];
  for (const s of result.systems) {
    if (out.length >= cap) break;
    out.push({
      key: `sys:${s.id}`,
      type: "system",
      id: s.id,
      label: s.name,
      href: exploreSystemHref(s.id),
    });
  }
  for (const b of result.bodies) {
    if (out.length >= cap) break;
    const sys = getSystem(b.systemId);
    out.push({
      key: `body:${b.id}`,
      type: "body",
      id: b.id,
      label: b.name,
      href: exploreHref(b.id, b.systemId),
      kindLabel: KIND_LABEL[b.kind],
      systemName: sys?.name ?? b.systemId,
    });
  }
  return out;
}

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const result = useMemo(() => searchCatalog(q), [q]);
  const hits = useMemo(() => flattenHits(result, TYPEAHEAD_CAP), [result]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  const go = useCallback(
    (hit: FlatHit) => {
      pushRecentSearch({
        label: hit.label,
        href: hit.href,
        kind: hit.type,
      });
      setQ("");
      setOpen(false);
      router.push(hit.href);
    },
    [router],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp") && hits.length) {
        setOpen(true);
        return;
      }
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (!hits.length) {
        if (e.key === "Enter" && q.trim()) {
          // No hits — send to Search page with query.
          e.preventDefault();
          router.push(`/search?q=${encodeURIComponent(q.trim())}`);
          setOpen(false);
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
        setActive((i) => (i + 1) % hits.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
        setActive((i) => (i - 1 + hits.length) % hits.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const hit = hits[active] ?? hits[0];
        if (hit) go(hit);
      }
    },
    [open, hits, active, go, q, router],
  );

  const systemHits = hits.filter((h) => h.type === "system");
  const bodyHits = hits.filter((h) => h.type === "body");

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070b14]/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4">
        <Link href="/" className="shrink-0 font-semibold tracking-tight text-sky-300">
          Orbitpedia
        </Link>

        <nav className="flex gap-1 rounded-lg bg-white/5 p-1 text-sm">
          {MODES.map((m) => {
            const activeMode =
              m.href === "/"
                ? pathname === "/" || pathname.startsWith("/explore")
                : pathname.startsWith(m.href);
            return (
              <Link
                key={m.href}
                href={m.href}
                className={`rounded-md px-3 py-1.5 transition ${
                  activeMode
                    ? "bg-sky-500/20 text-sky-200"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {m.label}
              </Link>
            );
          })}
        </nav>

        <div className="relative ml-auto w-full max-w-md">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={onKeyDown}
            placeholder="Search systems & bodies…"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-sky-500/50"
            aria-label="Search systems and bodies"
            aria-autocomplete="list"
            aria-expanded={open && hits.length > 0}
            role="combobox"
          />
          {open && hits.length > 0 && (
            <ul
              className="absolute left-0 right-0 top-full mt-1 max-h-80 overflow-auto rounded-lg border border-white/10 bg-[#0c1220] shadow-xl"
              role="listbox"
            >
              {systemHits.length > 0 && (
                <li className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                  Systems
                </li>
              )}
              {systemHits.map((h) => {
                const idx = hits.indexOf(h);
                return (
                  <li key={h.key} role="option" aria-selected={idx === active}>
                    <button
                      type="button"
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                        idx === active ? "bg-sky-500/15" : "hover:bg-white/5"
                      }`}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => go(h)}
                    >
                      <span className="text-zinc-100">{h.label}</span>
                      <span className="text-xs text-zinc-500">System</span>
                    </button>
                  </li>
                );
              })}
              {bodyHits.length > 0 && (
                <li className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                  Bodies
                </li>
              )}
              {bodyHits.map((h) => {
                const idx = hits.indexOf(h);
                return (
                  <li key={h.key} role="option" aria-selected={idx === active}>
                    <button
                      type="button"
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                        idx === active ? "bg-sky-500/15" : "hover:bg-white/5"
                      }`}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => go(h)}
                    >
                      <span className="min-w-0 truncate text-zinc-100">
                        {h.label}
                        <span className="ml-2 text-xs text-zinc-500">
                          {h.type === "body" ? h.kindLabel : ""}
                        </span>
                      </span>
                      {h.type === "body" && (
                        <span className="shrink-0 rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400">
                          {h.systemName}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </header>
  );
}
