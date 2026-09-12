"use client";

import type { Body, System } from "@/data/schema";
import { systemOverviewBlurb } from "@/lib/interestBlurb";
import {
  VISUAL_BINARY_NOTE,
  hasVisualBinaryCompanions,
} from "@/lib/visualBinaryNote";

type Props = {
  system: System;
  /** Optional members — used to compose earliest-planet discovery when blurb missing. */
  bodies?: Body[] | null;
  /** Optional compact mode for map side panel. */
  compact?: boolean;
  className?: string;
};

/** Lean system blurb / highlights / meta from systems/*.json (+ compose fallback). */
export function SystemFacts({
  system,
  bodies,
  compact = false,
  className = "",
}: Props) {
  const overview = systemOverviewBlurb(system, bodies);
  const highlights = system.highlights ?? [];
  const sources = system.meta?.sources;
  const fetched = system.meta?.fetchedAt;

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          System
        </p>
        <h2 className="mt-0.5 text-sm font-semibold text-zinc-100">
          {system.name}
          {system.home ? (
            <span className="ml-2 text-[11px] font-normal text-sky-400/90">
              home
            </span>
          ) : null}
        </h2>
      </div>

      {overview ? (
        <p className="text-sm leading-relaxed text-zinc-300">{overview}</p>
      ) : null}

      {bodies && hasVisualBinaryCompanions(bodies) ? (
        <p className="text-xs leading-relaxed text-zinc-500">
          {VISUAL_BINARY_NOTE}
        </p>
      ) : null}

      <dl className="grid gap-2">
        {system.planetCount != null ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wider text-zinc-500">
              Planets
            </dt>
            <dd className="mt-0.5 text-sm text-zinc-100">{system.planetCount}</dd>
          </div>
        ) : null}
        {system.starCount != null ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wider text-zinc-500">
              Stars
            </dt>
            <dd className="mt-0.5 text-sm text-zinc-100">{system.starCount}</dd>
          </div>
        ) : null}
        {system.hostSpectralType ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wider text-zinc-500">
              Host
            </dt>
            <dd className="mt-0.5 text-sm text-zinc-100">
              {system.hostSpectralType}
            </dd>
          </div>
        ) : null}
        {system.distanceLy != null ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wider text-zinc-500">
              Distance
            </dt>
            <dd className="mt-0.5 text-sm text-zinc-100">
              {system.distanceLy} ly
            </dd>
          </div>
        ) : null}
      </dl>

      {!compact && system.compactnessNote ? (
        <p className="text-xs leading-relaxed text-zinc-400">
          {system.compactnessNote}
        </p>
      ) : null}

      {highlights.length > 0 ? (
        <ul className="list-disc space-y-1 pl-4 text-sm text-zinc-400">
          {highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      ) : null}

      {!compact && sources && sources.length > 0 ? (
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
            Sources
          </h3>
          <ul className="space-y-1.5">
            {sources.map((s) => (
              <li key={s.url} className="text-sm">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-300/90 hover:text-sky-200 hover:underline"
                >
                  {s.name}
                </a>
              </li>
            ))}
          </ul>
          {fetched ? (
            <p className="mt-2 text-[11px] text-zinc-600">Fetched {fetched}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
