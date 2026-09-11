"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  getBodiesForSystem,
  getHomeSystem,
  KIND_LABEL,
} from "@/data/catalog";
import type { Body, BodyKind } from "@/data/schema";

const FILTERS: Array<BodyKind | "all"> = [
  "all",
  "star",
  "planet",
  "moon",
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
  /** Session-only hidden body ids (Explore). Rows stay listed muted/struck. */
  hiddenIds?: ReadonlySet<string>;
  /** Toggle hide/unhide for a body (mesh + orbit). */
  onToggleHidden?: (id: string) => void;
  /** Limit rail to one system graph (default: home). */
  systemId?: string;
};

type RailRow = { body: Body; depth: number; childCount: number };

/** Parent→child map in member order. */
function buildChildrenMap(bodies: Body[]): {
  roots: Body[];
  children: Map<string, Body[]>;
} {
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const index = new Map(bodies.map((b, i) => [b.id, i]));
  const children = new Map<string, Body[]>();
  const roots: Body[] = [];

  for (const b of bodies) {
    if (b.parentId && byId.has(b.parentId)) {
      const list = children.get(b.parentId) ?? [];
      list.push(b);
      children.set(b.parentId, list);
    } else {
      roots.push(b);
    }
  }

  for (const [, list] of children) {
    list.sort((a, b) => (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0));
  }

  return { roots, children };
}

/** Tree rows; skip children of ids in `collapsed`. */
function buildRailTree(
  bodies: Body[],
  collapsed: ReadonlySet<string>,
): RailRow[] {
  const { roots, children } = buildChildrenMap(bodies);
  const rows: RailRow[] = [];
  const walk = (b: Body, depth: number) => {
    const kids = children.get(b.id) ?? [];
    rows.push({ body: b, depth, childCount: kids.length });
    if (collapsed.has(b.id)) return;
    for (const kid of kids) walk(kid, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return rows;
}

export function BodyRail({
  activeId,
  selectedIds = [],
  onToggleSelect,
  selectMode = false,
  onFocus,
  hiddenIds,
  onToggleHidden,
  systemId,
}: Props) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [open, setOpen] = useState(true);
  /** Parent ids whose children are folded in the All-tab tree (list only). */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  /** All-tab only: when false, moon rows are omitted from the list (Explore unchanged). */
  const [showMoonsInAll, setShowMoonsInAll] = useState(true);

  const bodies = useMemo(() => {
    const id = systemId ?? getHomeSystem().id;
    return getBodiesForSystem(id);
  }, [systemId]);

  const rows = useMemo(() => {
    const filtered =
      filter === "all" ? bodies : bodies.filter((b) => b.kind === filter);
    // Kind filter: flat list (tree only when viewing the full system graph).
    if (filter !== "all") {
      return filtered.map((body) => ({ body, depth: 0, childCount: 0 }));
    }
    const treeBodies = showMoonsInAll
      ? bodies
      : bodies.filter((b) => b.kind !== "moon");
    return buildRailTree(treeBodies, collapsed);
  }, [bodies, filter, collapsed, showMoonsInAll]);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (!open) {
    return (
      <aside className="flex h-full min-h-0 w-9 shrink-0 flex-col overflow-hidden border-r border-white/10 bg-[#080d18]">
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
    <aside className="flex h-full min-h-0 w-56 shrink-0 flex-col overflow-hidden border-r border-white/10 bg-[#080d18]">
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
        {filter === "all" ? (
          <button
            type="button"
            onClick={() => setShowMoonsInAll((v) => !v)}
            className={`mt-2 w-full rounded px-2 py-1 text-[11px] ${
              showMoonsInAll
                ? "bg-white/5 text-zinc-400 hover:text-zinc-200"
                : "bg-sky-500/15 text-sky-200"
            }`}
            aria-pressed={!showMoonsInAll}
            title={
              showMoonsInAll
                ? "Hide moons from this list only"
                : "Show moons in this list"
            }
          >
            {showMoonsInAll ? "Hide moons in list" : "Show moons in list"}
          </button>
        ) : null}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {rows.map(({ body: b, depth, childCount }) => {
          const selected = selectedIds.includes(b.id);
          const active = activeId === b.id;
          const hidden = hiddenIds?.has(b.id) ?? false;
          const isCollapsed = collapsed.has(b.id);
          const pad =
            depth > 0 ? { paddingLeft: `${8 + depth * 12}px` } : undefined;
          const rowClass = `flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
            hidden
              ? "text-zinc-500 line-through opacity-60"
              : active || selected
                ? "bg-sky-500/20 text-sky-100"
                : "text-zinc-300 hover:bg-white/5"
          }`;

          const swatch = (
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${hidden ? "opacity-40" : ""}`}
              style={{ background: b.color ?? "#888" }}
            />
          );

          const twisty =
            filter === "all" && childCount > 0 ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapsed(b.id);
                }}
                className="shrink-0 rounded px-1 py-0.5 font-mono text-xs text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                aria-expanded={!isCollapsed}
                aria-label={
                  isCollapsed
                    ? `Expand ${b.name} moons`
                    : `Collapse ${b.name} moons`
                }
                title={isCollapsed ? "Expand children" : "Collapse children"}
              >
                {isCollapsed ? ">" : "<"}
              </button>
            ) : depth > 0 ? (
              <span className="w-4 shrink-0 text-center text-[10px] text-zinc-600" aria-hidden>
                └
              </span>
            ) : (
              <span className="w-4 shrink-0" aria-hidden />
            );

          const label = (
            <>
              {twisty}
              {swatch}
              <span className="truncate">{b.name}</span>
            </>
          );

          const hideBtn =
            onToggleHidden != null ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleHidden(b.id);
                }}
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                  hidden
                    ? "bg-amber-500/15 text-amber-200/90 hover:bg-amber-500/25"
                    : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                }`}
                aria-pressed={hidden}
                aria-label={hidden ? `Show ${b.name}` : `Hide ${b.name}`}
                title={hidden ? "Show in Explore" : "Hide in Explore"}
              >
                {hidden ? "Hidden" : "Hide"}
              </button>
            ) : null;

          return (
            <li
              key={b.id}
              className="mb-0.5 flex items-center gap-0.5"
              style={pad}
            >
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
                  {label}
                </button>
              ) : onFocus ? (
                <>
                  <button
                    type="button"
                    onClick={() => onFocus(b.id)}
                    className={rowClass}
                  >
                    {label}
                  </button>
                  {hideBtn}
                </>
              ) : (
                <Link href={`/body/${b.id}`} className={rowClass}>
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
