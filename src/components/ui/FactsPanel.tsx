"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { KIND_LABEL } from "@/data/catalog";
import type { Body } from "@/data/schema";
import { periodFromA } from "@/lib/kepler";
import {
  formatAu,
  formatDensity,
  formatMass,
  formatPeriodDays,
  formatRadius,
} from "@/lib/units";

type Props = {
  body: Body | null | undefined;
  onClear?: () => void;
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wider text-zinc-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-zinc-100">{value}</dd>
    </div>
  );
}

export function FactsPanel({ body, onClear }: Props) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [body?.id]);

  if (!body) {
    return (
      <aside className="pointer-events-auto flex w-full flex-col border-t border-white/10 bg-[#080d18]/95 p-4 backdrop-blur md:h-full md:w-72 md:shrink-0 md:border-l md:border-t-0 lg:w-80">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Facts
        </p>
        <p className="mt-3 text-sm text-zinc-500">
          Select a body in the scene or rail to see cool facts.
        </p>
        <p className="mt-2 text-xs text-zinc-600">
          Clear with Esc, panel ✕, second click, or right-click.
        </p>
      </aside>
    );
  }

  const period =
    body.orbit?.periodD ??
    (body.orbit ? periodFromA(body.orbit.aAu) : undefined);
  const note = body.facts.discoveryNotes;
  const discovered = body.facts.discoveryDate;

  return (
    <aside className="pointer-events-auto flex max-h-[45vh] w-full flex-col overflow-hidden border-t border-white/10 bg-[#080d18]/95 backdrop-blur md:max-h-none md:h-full md:w-72 md:shrink-0 md:border-l md:border-t-0 lg:w-80">
      <div className="flex items-start justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: body.color ?? "#888" }}
            />
            <h2 className="truncate text-sm font-semibold text-zinc-100">
              {body.name}
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">{KIND_LABEL[body.kind]}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="rounded-md px-2 py-1 text-xs text-sky-300 hover:bg-sky-500/15"
            aria-expanded={expanded}
          >
            {expanded ? "Less" : "Full"}
          </button>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
              aria-label="Clear selection"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!expanded ? (
          <div className="space-y-3">
            <dl className="grid gap-2">
              <Stat label="Mass" value={formatMass(body.facts.massKg)} />
              <Stat
                label="Mean radius"
                value={formatRadius(body.facts.radiusMeanKm)}
              />
              {discovered && (
                <Stat label="Discovered" value={discovered} />
              )}
              {period != null && (
                <Stat label="Orbital period" value={formatPeriodDays(period)} />
              )}
              {body.orbit && (
                <Stat label="Semi-major axis" value={formatAu(body.orbit.aAu)} />
              )}
            </dl>
            {note && (
              <p className="text-sm leading-relaxed text-zinc-400">{note}</p>
            )}
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm text-sky-200 hover:border-sky-500/30 hover:bg-sky-500/10"
            >
              Full encyclopedia in panel →
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Overview
              </h3>
              <p className="text-sm text-zinc-300">
                {note ??
                  `${body.name} is a ${KIND_LABEL[body.kind].toLowerCase()} in the Orbitpedia Phase 1 catalog.`}
              </p>
              <p className="mt-2 text-[11px] text-zinc-600">
                Source: {body.meta.source}
              </p>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Key facts
              </h3>
              <dl className="grid gap-2">
                <Stat label="Mass" value={formatMass(body.facts.massKg)} />
                <Stat
                  label="Mean radius"
                  value={formatRadius(body.facts.radiusMeanKm)}
                />
                {discovered && (
                  <Stat label="Discovered" value={discovered} />
                )}
                {body.facts.densityGcm3 != null && (
                  <Stat
                    label="Density"
                    value={formatDensity(body.facts.densityGcm3)}
                  />
                )}
                {body.facts.rotationPeriodD != null && (
                  <Stat
                    label="Rotation period"
                    value={
                      formatPeriodDays(Math.abs(body.facts.rotationPeriodD)) +
                      (body.facts.rotationPeriodD < 0 ? " (retrograde)" : "")
                    }
                  />
                )}
                {body.facts.albedo != null && (
                  <Stat
                    label="Albedo"
                    value={body.facts.albedo.toPrecision(3)}
                  />
                )}
              </dl>
            </section>

            {body.orbit && (
              <section>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Orbit
                </h3>
                <dl className="grid gap-2">
                  <Stat label="a" value={formatAu(body.orbit.aAu)} />
                  <Stat label="e" value={body.orbit.e.toPrecision(4)} />
                  <Stat
                    label="i"
                    value={`${body.orbit.iDeg.toPrecision(4)}°`}
                  />
                  <Stat
                    label="Ω"
                    value={`${body.orbit.omDeg.toPrecision(4)}°`}
                  />
                  <Stat
                    label="ω"
                    value={`${body.orbit.wDeg.toPrecision(4)}°`}
                  />
                  <Stat
                    label="M"
                    value={`${body.orbit.maDeg.toPrecision(4)}°`}
                  />
                  {period != null && (
                    <Stat label="Period" value={formatPeriodDays(period)} />
                  )}
                  <Stat label="Epoch (JD)" value={String(body.orbit.epochJd)} />
                </dl>
              </section>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-white/10 px-4 py-3">
        <Link
          href={`/body/${body.id}`}
          className="block text-center text-xs text-zinc-500 hover:text-sky-300"
        >
          Open full page →
        </Link>
      </div>
    </aside>
  );
}
