"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  bodyHref,
  getBodiesForSystem,
  getHomeSystem,
  isEarthSatsSystemId,
  KIND_LABEL,
} from "@/data/catalog";
import type { Body, BodyKind } from "@/data/schema";

const FILTERS: Array<BodyKind | "all"> = [
  "all",
  "black_hole",
  "star",
  "planet",
  "moon",
  "satellite",
  "dwarf_planet",
  "asteroid",
  "probe",
];

/** All-tab kind sections (moons nest under planet/dwarf, not their own section). */
const KIND_GROUPS: Array<{
  kind: BodyKind;
  label: string;
  /** Always render the section header (multi-star ready). */
  always?: boolean;
}> = [
  { kind: "black_hole", label: "Black holes" },
  { kind: "star", label: "Stars", always: true },
  { kind: "planet", label: "Planets" },
  { kind: "satellite", label: "Satellites" },
  { kind: "dwarf_planet", label: "Dwarf planets" },
  { kind: "asteroid", label: "Asteroids" },
  { kind: "probe", label: "Probes" },
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

/** Rows for one kind section: section roots + nested children (moons / companion stars). */
function buildGroupRows(
  bodies: Body[],
  groupKind: BodyKind,
  collapsed: ReadonlySet<string>,
): RailRow[] {
  const { children } = buildChildrenMap(bodies);
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const index = new Map(bodies.map((b, i) => [b.id, i]));
  // Same-kind children (e.g. companion star under primary) nest under parent — not also as roots.
  const sectionRoots = bodies
    .filter((b) => {
      if (b.kind !== groupKind) return false;
      if (b.parentId) {
        const parent = byId.get(b.parentId);
        if (parent && parent.kind === groupKind) return false;
      }
      return true;
    })
    .sort((a, b) => (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0));

  const rows: RailRow[] = [];
  const walk = (b: Body, depth: number) => {
    const kids = children.get(b.id) ?? [];
    rows.push({ body: b, depth, childCount: kids.length });
    if (collapsed.has(b.id)) return;
    for (const kid of kids) walk(kid, depth + 1);
  };
  for (const r of sectionRoots) walk(r, 0);
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
  /** Collapsed kind-group headers on All tab. */
  const [groupCollapsed, setGroupCollapsed] = useState<Set<BodyKind>>(
    () => new Set(),
  );

  const earthSatsMode = systemId != null && isEarthSatsSystemId(systemId);

  useEffect(() => {
    if (earthSatsMode && filter !== "all" && filter !== "satellite") {
      setFilter("all");
    }
  }, [earthSatsMode, filter]);

  const bodies = useMemo(() => {
    const id = systemId ?? getHomeSystem().id;
    const list = getBodiesForSystem(id);
    // Earth-sats: flat satellites-only rail (omit Earth center + empty Stars/Planets).
    if (isEarthSatsSystemId(id)) {
      return list.filter((b) => b.kind === "satellite");
    }
    return list;
  }, [systemId]);

  const parentIdsWithChildren = useMemo(() => {
    const { children } = buildChildrenMap(bodies);
    return [...children.keys()];
  }, [bodies]);

  const allMoonsCollapsed =
    parentIdsWithChildren.length > 0 &&
    parentIdsWithChildren.every((id) => collapsed.has(id));

  const flatKindRows = useMemo((): RailRow[] => {
    if (filter === "all") return [];
    return bodies
      .filter((b) => b.kind === filter)
      .map((body) => ({ body, depth: 0, childCount: 0 }));
  }, [bodies, filter]);

  const groupedSections = useMemo(() => {
    if (filter !== "all") return [];
    return KIND_GROUPS.map((g) => {
      const rows = buildGroupRows(bodies, g.kind, collapsed);
      return { ...g, rows };
    }).filter((g) => {
      // earth-sats: never show empty Stars/Planets (always:true is wrong here)
      if (earthSatsMode) return g.rows.length > 0;
      return g.always || g.rows.length > 0;
    });
  }, [bodies, filter, collapsed, earthSatsMode]);

  const toggleAllMoonsInList = useCallback(() => {
    setCollapsed((prev) => {
      if (
        parentIdsWithChildren.length > 0 &&
        parentIdsWithChildren.every((id) => prev.has(id))
      ) {
        return new Set(); // expand all
      }
      return new Set(parentIdsWithChildren); // collapse all
    });
  }, [parentIdsWithChildren]);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((kind: BodyKind) => {
    setGroupCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  const renderRow = (row: RailRow) => {
    const { body: b, depth, childCount } = row;
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
      ) : null;

    const label = (
      <>
        {depth > 0 ? (
          <span className="shrink-0 text-[10px] text-zinc-600" aria-hidden>
            └
          </span>
        ) : null}
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
          <>
            <button
              type="button"
              onClick={() => onToggleSelect(b.id)}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                selected
                  ? "bg-violet-500/20 text-violet-100"
                  : "text-zinc-300 hover:bg-white/5"
              }`}
            >
              {label}
            </button>
            {twisty}
          </>
        ) : onFocus ? (
          <>
            <button
              type="button"
              onClick={() => onFocus(b.id)}
              className={rowClass}
            >
              {label}
            </button>
            {twisty}
            {hideBtn}
          </>
        ) : (
          <>
            <Link href={bodyHref(b.id, b.systemId)} className={rowClass}>
              {label}
            </Link>
            {twisty}
          </>
        )}
      </li>
    );
  };

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
          {(earthSatsMode
            ? (["all", "satellite"] as Array<(typeof FILTERS)[number]>)
            : FILTERS
          ).map((f) => (
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
              {f === "all" ? "All" : (KIND_LABEL[f] ?? f)}
            </button>
          ))}
        </div>
        {filter === "all" && parentIdsWithChildren.length > 0 ? (
          <button
            type="button"
            onClick={toggleAllMoonsInList}
            className={`mt-2 w-full rounded px-2 py-1 text-[11px] ${
              allMoonsCollapsed
                ? "bg-sky-500/15 text-sky-200"
                : "bg-white/5 text-zinc-400 hover:text-zinc-200"
            }`}
            aria-pressed={allMoonsCollapsed}
            title={
              allMoonsCollapsed
                ? "Expand all moon lists"
                : "Collapse all moon lists"
            }
          >
            {allMoonsCollapsed ? "Show moons in list" : "Hide moons in list"}
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {filter === "all" ? (
          <div className="space-y-2">
            {groupedSections.map((g) => {
              const closed = groupCollapsed.has(g.kind);
              return (
                <div key={g.kind}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.kind)}
                    className="mb-0.5 flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] font-medium uppercase tracking-wider text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                    aria-expanded={!closed}
                  >
                    <span className="font-mono text-zinc-600" aria-hidden>
                      {closed ? "▸" : "▾"}
                    </span>
                    <span>{g.label}</span>
                    <span className="ml-auto tabular-nums text-zinc-600">
                      {g.rows.filter((r) => r.depth === 0).length}
                    </span>
                  </button>
                  {!closed ? (
                    g.rows.length > 0 ? (
                      <ul>{g.rows.map((row) => renderRow(row))}</ul>
                    ) : (
                      <p className="px-2 py-1 text-[11px] text-zinc-600">
                        None in this system
                      </p>
                    )
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <ul>{flatKindRows.map((row) => renderRow(row))}</ul>
        )}
      </div>
    </aside>
  );
}
