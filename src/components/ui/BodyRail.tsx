"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { getBodiesForSystem, getHomeSystem, KIND_LABEL } from "@/data/catalog";
import type { BodyKind } from "@/data/schema";

const FILTERS: Array<BodyKind | "all"> = [
  "all",
  "star",
  "planet",
  "dwarf_planet",
  "asteroid",
];

type Props = {
  activeId?: string;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
  selectMode?: boolean;
  /** When set, row click focuses instead of navigating to detail. */
  onFocus?: (id: string) => void;
  /** Limit rail to one system graph (default: home). */
  systemId?: string;
};

export function BodyRail({
  activeId,
  selectedIds = [],
  onToggleSelect,
  selectMode = false,
  onFocus,
  systemId,
}: Props) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [open, setOpen] = useState(true);

  const bodies = useMemo(() => {
    const id = systemId ?? getHomeSystem().id;
    return getBodiesForSystem(id);
  }, [systemId]);

  const list = useMemo(
    () => (filter === "all" ? bodies : bodies.filter((b) => b.kind === filter)),
    [filter, bodies],
  );

  if (!open) {
    return (
      <aside className="flex h-full w-9 shrink-0 flex-col border-r border-white/10 bg-[#080d18]">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex flex-1 flex-col items-center gap-2 px-1 py-3 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
          aria-expanded={false}
          aria-label="Expand bodies list"
          title="Expand bodies"
        >
          <span className="text-sm leading-none" aria-hidden>
            ›
          </span>
          <span
            className="text-[10px] font-medium uppercase tracking-wider"
            style={{ writingMode: "vertical-rl" }}
          >
            Bodies
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-white/10 bg-[#080d18]">
      <div className="border-b border-white/10 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Bodies
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
            aria-expanded={true}
            aria-label="Collapse bodies list"
            title="Collapse"
          >
            ‹
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded px-2 py-0.5 text-[11px] ${
                filter === f
                  ? "bg-sky-500/20 text-sky-200"
                  : "bg-white/5 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {f === "all" ? "All" : KIND_LABEL[f]}
            </button>
          ))}
        </div>
      </div>
      <ul className="flex-1 overflow-y-auto p-2">
        {list.map((b) => {
          const selected = selectedIds.includes(b.id);
          const active = activeId === b.id;
          const rowClass = `flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
            active || selected
              ? "bg-sky-500/20 text-sky-100"
              : "text-zinc-300 hover:bg-white/5"
          }`;

          return (
            <li key={b.id} className="mb-0.5">
              {selectMode && onToggleSelect ? (
                <button
                  type="button"
                  onClick={() => onToggleSelect(b.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                    selected
                      ? "bg-violet-500/20 text-violet-100"
                      : "text-zinc-300 hover:bg-white/5"
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: b.color ?? "#888" }}
                  />
                  <span className="truncate">{b.name}</span>
                </button>
              ) : onFocus ? (
                <button
                  type="button"
                  onClick={() => onFocus(b.id)}
                  className={rowClass}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: b.color ?? "#888" }}
                  />
                  <span className="truncate">{b.name}</span>
                </button>
              ) : (
                <Link href={`/body/${b.id}`} className={rowClass}>
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: b.color ?? "#888" }}
                  />
                  <span className="truncate">{b.name}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
