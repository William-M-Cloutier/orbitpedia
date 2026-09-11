"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { getHomeSystem, searchBodies } from "@/data/catalog";

const MODES = [
  { href: "/", label: "Explore" },
  { href: "/systems", label: "Systems" },
  { href: "/discover", label: "Discover" },
  { href: "/search", label: "Search" },
] as const;

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const homeId = getHomeSystem().id;

  const hits = useMemo(() => (q.trim() ? searchBodies(q).slice(0, 8) : []), [q]);

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070b14]/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4">
        <Link href="/" className="shrink-0 font-semibold tracking-tight text-sky-300">
          Orbitpedia
        </Link>

        <nav className="flex gap-1 rounded-lg bg-white/5 p-1 text-sm">
          {MODES.map((m) => {
            const active =
              m.href === "/"
                ? pathname === "/" || pathname.startsWith("/explore")
                : pathname.startsWith(m.href);
            return (
              <Link
                key={m.href}
                href={m.href}
                className={`rounded-md px-3 py-1.5 transition ${
                  active
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
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Search bodies…"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-sky-500/50"
            aria-label="Search bodies"
          />
          {open && hits.length > 0 && (
            <ul className="absolute left-0 right-0 top-full mt-1 overflow-hidden rounded-lg border border-white/10 bg-[#0c1220] shadow-xl">
              {hits.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white/5"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setQ("");
                      setOpen(false);
                      const params = new URLSearchParams();
                      if (b.systemId !== homeId) {
                        params.set("system", b.systemId);
                      }
                      params.set("focus", b.id);
                      router.push(`/?${params.toString()}`);
                    }}
                  >
                    <span className="text-zinc-100">{b.name}</span>
                    <span className="text-xs text-zinc-500">
                      {b.kind}
                      {b.systemId !== homeId ? ` · ${b.systemId}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </header>
  );
}
