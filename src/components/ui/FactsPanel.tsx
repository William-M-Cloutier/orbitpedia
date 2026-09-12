"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { KIND_LABEL, getBodiesForSystem } from "@/data/catalog";
import {
  bodyProvenance,
  type Body,
  type System,
} from "@/data/schema";
import { SystemFacts } from "@/components/ui/SystemFacts";
import {
  keyFactRows,
  quickPhysFactRows,
  type FactRow,
} from "@/lib/factsDisplay";
import { overviewBlurb } from "@/lib/interestBlurb";
import {
  VISUAL_BINARY_NOTE,
  isVisualBinaryCompanion,
  projectedSepDisplay,
} from "@/lib/visualBinaryNote";
import { periodFromA } from "@/lib/kepler";
import { formatAu, formatPeriodDays } from "@/lib/units";
import { satelliteFactRows } from "@/lib/satelliteDisplay";
import type { SurfacePoi } from "@/data/poiSchema";
import { formatLatDeg, formatLonDeg } from "@/lib/latLon";
import { missionFactRows } from "@/lib/missionDisplay";

type Props = {
  body: Body | null | undefined;
  /** Active system — shown when nothing is focused. */
  system?: System | null;
  onClear?: () => void;
  /** Selected surface POI on the focused body (geographic lat/lon). */
  selectedPoi?: SurfacePoi | null;
  onClearPoi?: () => void;
};

function Stat({
  label,
  value,
  unknown,
  reason,
  approximate,
}: {
  label: string;
  value: string;
  unknown?: boolean;
  reason?: string;
  approximate?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wider text-zinc-500">
        {label}
      </dt>
      <dd
        className={
          unknown
            ? "mt-0.5 text-sm text-zinc-500"
            : "mt-0.5 text-sm text-zinc-100"
        }
        title={approximate ? "Approximate" : undefined}
      >
        {value}
        {unknown && reason ? (
          <span className="mt-0.5 block text-[11px] font-normal text-zinc-600">
            {reason}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function FactStats({ rows }: { rows: FactRow[] }) {
  return (
    <>
      {rows.map((r) =>
        r.value != null ? (
          <Stat
            key={r.key}
            label={r.label}
            value={r.value}
            unknown={r.unknown}
            reason={r.reason}
            approximate={r.approximate}
          />
        ) : null,
      )}
    </>
  );
}

function formatDiscoveryDate(raw: string): string {
  // Prefer readable calendar date; fall back to the raw catalog string.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) {
    const d = new Date(
      Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])),
    );
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  return raw;
}

/**
 * Discovery display — special-cased (not expected-by-kind Unknown).
 * Stars / Sun → N/A; dated cards → date; else notes or antiquity prose.
 */
function discoveryDisplay(body: Body): string {
  if (body.facts.discoveryDate) return formatDiscoveryDate(body.facts.discoveryDate);
  if (body.kind === "star" || body.id === "sun") return "N/A";
  if (body.facts.discoveryNotes) return body.facts.discoveryNotes;
  return "Known since antiquity";
}

function SourcesList({ body }: { body: Body }) {
  const sources = body.meta.sources;
  if (!sources?.length) return null;
  const fetched = body.meta.fetchedAt;
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
        Sources
      </h3>
      <ul className="space-y-2">
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
            {s.fields && s.fields.length > 0 && (
              <p className="mt-0.5 text-[11px] text-zinc-600">
                Fields: {s.fields.join(", ")}
              </p>
            )}
          </li>
        ))}
      </ul>
      {fetched && (
        <p className="mt-2 text-[11px] text-zinc-600">Fetched {fetched}</p>
      )}
    </section>
  );
}


function PoiDetail({
  poi,
  onClearPoi,
}: {
  poi: SurfacePoi;
  onClearPoi?: () => void;
}) {
  const elev =
    poi.elevationM != null
      ? `${poi.elevationM.toLocaleString("en-US")} m`
      : null;
  const depth =
    poi.depthM != null ? `${poi.depthM.toLocaleString("en-US")} m` : null;
  return (
    <section className="mb-4 rounded-lg border border-amber-400/25 bg-amber-500/[0.07] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-amber-200/70">
            Surface place
          </p>
          <h3 className="mt-0.5 truncate text-sm font-semibold text-zinc-100">
            {poi.name}
          </h3>
        </div>
        {onClearPoi ? (
          <button
            type="button"
            onClick={onClearPoi}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
            aria-label="Clear surface place"
          >
            ✕
          </button>
        ) : null}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-zinc-300">{poi.summary}</p>
      <dl className="mt-3 grid gap-2">
        <Stat
          label="Latitude"
          value={formatLatDeg(poi.latDeg)}
          approximate={poi.confidence === "assumed"}
        />
        <Stat
          label="Longitude"
          value={formatLonDeg(poi.lonDeg)}
          approximate={poi.confidence === "assumed"}
        />
        {elev ? <Stat label="Elevation" value={elev} /> : null}
        {depth ? <Stat label="Depth" value={depth} /> : null}
      </dl>
      <ul className="mt-3 space-y-1.5">
        {poi.sources.map((s) => (
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
    </section>
  );
}

export function FactsPanel({ body, system, onClear, selectedPoi, onClearPoi }: Props) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [body?.id, selectedPoi?.id]);

  // Empty selection: lean system facts (not a blank column).
  if (!body) {
    if (!system) return null;
    return (
      <aside className="pointer-events-auto flex max-h-[45vh] w-full flex-col overflow-hidden border-t border-white/10 bg-[#080d18]/95 backdrop-blur md:max-h-none md:h-full md:w-full md:border-l md:border-t-0">
        <div className="flex-1 overflow-y-auto p-4">
          <SystemFacts system={system} bodies={getBodiesForSystem(system.id)} />
          <p className="mt-4 text-xs text-zinc-600">
            Select a body in the scene or rail for body facts.
          </p>
        </div>
      </aside>
    );
  }

  const period =
    body.orbit?.periodD ??
    (body.orbit ? periodFromA(body.orbit.aAu) : undefined);
  const overview = overviewBlurb(body, system);
  const sepLabel = projectedSepDisplay(body);
  const visualBinary = isVisualBinaryCompanion(body);
  const discovered = discoveryDisplay(body);
  const quickRows = quickPhysFactRows(body);
  const fullRows = keyFactRows(body);
  const satRows = satelliteFactRows(body);
  const isSatellite = body.kind === "satellite";
  const missionRows = missionFactRows(body);
  const isProbe = body.kind === "probe";

  return (
    <aside className="pointer-events-auto flex max-h-[45vh] w-full flex-col overflow-hidden border-t border-white/10 bg-[#080d18]/95 backdrop-blur md:max-h-none md:h-full md:w-full md:border-l md:border-t-0">
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
        {selectedPoi && selectedPoi.bodyId === body.id ? (
          <PoiDetail poi={selectedPoi} onClearPoi={onClearPoi} />
        ) : null}
        {!expanded ? (
          <div className="space-y-3">
            <dl className="grid gap-2">
              {satRows.map((r) => (
                <Stat key={r.label} label={r.label} value={r.value} />
              ))}
              {missionRows.map((r) => (
                <Stat key={r.label} label={r.label} value={r.value} />
              ))}
              {!isSatellite && !isProbe ? (
                <Stat label="Discovered" value={discovered} />
              ) : null}
              <FactStats rows={quickRows} />
              {period != null && (
                <Stat label="Orbital period" value={formatPeriodDays(period)} />
              )}
              {body.orbit && (
                <Stat label="Semi-major axis" value={formatAu(body.orbit.aAu)} />
              )}
            </dl>
            {overview && (
              <p className="text-sm leading-relaxed text-zinc-400">{overview}</p>
            )}
            {sepLabel ? (
              <p className="text-sm text-zinc-400">
                Projected separation {sepLabel}
              </p>
            ) : null}
            {visualBinary ? (
              <p className="text-xs leading-relaxed text-zinc-400">
                {VISUAL_BINARY_NOTE}
              </p>
            ) : null}
            {body.meta.sources && body.meta.sources.length > 0 && (
              <p className="text-[11px] text-zinc-500">
                {body.meta.sources.length} source
                {body.meta.sources.length === 1 ? "" : "s"} — expand Full to open
                links
              </p>
            )}
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm text-sky-200 hover:border-sky-500/30 hover:bg-sky-500/10"
            >
              More facts →
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Overview
              </h3>
              {overview ? (
                <p className="text-sm text-zinc-300">{overview}</p>
              ) : null}
              {sepLabel ? (
                <p
                  className={`text-sm text-zinc-400${overview ? " mt-2" : ""}`}
                >
                  Projected separation {sepLabel}
                </p>
              ) : null}
              {visualBinary ? (
                <p
                  className={`text-xs leading-relaxed text-zinc-400${
                    overview || sepLabel ? " mt-2" : ""
                  }`}
                >
                  {VISUAL_BINARY_NOTE}
                </p>
              ) : null}
              <p className={`text-[11px] text-zinc-600${overview ? " mt-2" : ""}`}>
                Source: {bodyProvenance(body)}
              </p>
            </section>

            {satRows.length > 0 ? (
              <section>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Satellite
                </h3>
                <dl className="grid gap-2">
                  {satRows.map((r) => (
                    <Stat key={r.label} label={r.label} value={r.value} />
                  ))}
                </dl>
              </section>
            ) : null}

            {missionRows.length > 0 ? (
              <section>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Mission
                </h3>
                <dl className="grid gap-2">
                  {missionRows.map((r) => (
                    <Stat key={r.label} label={r.label} value={r.value} />
                  ))}
                </dl>
              </section>
            ) : null}

            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Key facts
              </h3>
              <dl className="grid gap-2">
                {!isSatellite && !isProbe ? (
                  <Stat label="Discovered" value={discovered} />
                ) : null}
                <FactStats rows={fullRows} />
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
                  {body.orbit.epochJd != null && (
                    <Stat label="Epoch (JD)" value={String(body.orbit.epochJd)} />
                  )}
                  <Stat label="Frame" value={body.orbit.frame} />
                </dl>
              </section>
            )}

            <SourcesList body={body} />
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
