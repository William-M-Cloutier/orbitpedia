import Link from "next/link";
import { BodyRail } from "@/components/ui/BodyRail";
import { AppShell } from "@/components/ui/AppShell";
import { exploreHref, getHomeSystem, getSystem, KIND_LABEL } from "@/data/catalog";
import { bodyProvenance, type Body } from "@/data/schema";
import { keyFactRows } from "@/lib/factsDisplay";
import { satelliteFactRows } from "@/lib/satelliteDisplay";
import { overviewBlurb } from "@/lib/interestBlurb";
import {
  VISUAL_BINARY_NOTE,
  isVisualBinaryCompanion,
  projectedSepDisplay,
} from "@/lib/visualBinaryNote";
import { periodFromA } from "@/lib/kepler";
import { formatAu, formatPeriodDays } from "@/lib/units";
import { CatalogChartsLazy } from "@/viz/CatalogChartsLazy";

/** Shared body detail layout (curated SSR + archive client bridge). */
export function BodyDetailView({ body }: { body: Body }) {
  const period =
    body.orbit?.periodD ??
    (body.orbit ? periodFromA(body.orbit.aAu) : undefined);
  const homeId = getHomeSystem().id;
  const overview = overviewBlurb(body, getSystem(body.systemId));
  const sepLabel = projectedSepDisplay(body);
  const visualBinary = isVisualBinaryCompanion(body);
  const satRows = satelliteFactRows(body);

  return (
    <AppShell rail={<BodyRail activeId={body.id} systemId={body.systemId} />}>
      <div className="mx-auto max-w-4xl space-y-8 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className="h-4 w-4 rounded-full"
              style={{ background: body.color ?? "#888" }}
            />
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">
                {body.name}
              </h1>
              <p className="text-sm text-zinc-500">
                {KIND_LABEL[body.kind]}
                {body.systemId !== homeId ? ` · ${body.systemId}` : ""}
                {body.aliases?.length
                  ? ` · also ${body.aliases.join(", ")}`
                  : ""}
              </p>
            </div>
          </div>
          <Link
            href={exploreHref(body.id, body.systemId)}
            className="rounded-lg bg-sky-500/20 px-4 py-2 text-sm text-sky-200 hover:bg-sky-500/30"
          >
            Open in Explore →
          </Link>
        </div>

        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
            Overview
          </h2>
          {overview ? (
            <p className="text-zinc-300">{overview}</p>
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
              className={`text-xs leading-relaxed text-zinc-500${
                overview || sepLabel ? " mt-2" : ""
              }`}
            >
              {VISUAL_BINARY_NOTE}
            </p>
          ) : null}
          <p
            className={`text-xs text-zinc-600${
              overview ||
              sepLabel ||
              visualBinary
                ? " mt-2"
                : ""
            }`}
          >
            Source: {bodyProvenance(body)}
          </p>
        </section>

        {satRows.length > 0 ? (
          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
              Satellite
            </h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              {satRows.map((r) => (
                <div
                  key={r.label}
                  className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3"
                >
                  <dt className="text-xs text-zinc-500">{r.label}</dt>
                  <dd className="mt-0.5 text-zinc-100">{r.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <section>
          <h2 className="mb-3 text-lg font-medium text-zinc-200">Key facts</h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            {keyFactRows(body).map((row) => (
              <div
                key={row.key}
                className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3"
              >
                <dt className="text-xs text-zinc-500">{row.label}</dt>
                <dd
                  className={
                    row.unknown
                      ? "mt-0.5 text-zinc-500"
                      : "mt-0.5 text-zinc-100"
                  }
                  title={row.approximate ? "Approximate" : undefined}
                >
                  {row.value}
                  {row.unknown && row.reason ? (
                    <span className="mt-0.5 block text-[11px] text-zinc-600">
                      {row.reason}
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {body.orbit && (
          <section>
            <h2 className="mb-3 text-lg font-medium text-zinc-200">Orbit</h2>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  ["Semi-major axis a", formatAu(body.orbit.aAu)],
                  ["Eccentricity e", body.orbit.e.toPrecision(4)],
                  ["Inclination i", `${body.orbit.iDeg.toPrecision(4)}°`],
                  ["Ω (longitude of node)", `${body.orbit.omDeg.toPrecision(4)}°`],
                  ["ω (argument of periapsis)", `${body.orbit.wDeg.toPrecision(4)}°`],
                  ["Mean anomaly M", `${body.orbit.maDeg.toPrecision(4)}°`],
                  [
                    "Period",
                    period != null ? formatPeriodDays(period) : null,
                  ],
                  [
                    "Epoch (JD)",
                    body.orbit.epochJd != null
                      ? String(body.orbit.epochJd)
                      : null,
                  ],
                  ["Frame", body.orbit.frame],
                ] as Array<[string, string | null]>
              )
                .filter(([, v]) => v != null)
                .map(([k, v]) => (
                  <div
                    key={k}
                    className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3"
                  >
                    <dt className="text-xs text-zinc-500">{k}</dt>
                    <dd className="mt-0.5 font-mono text-sm text-zinc-100">
                      {v}
                    </dd>
                  </div>
                ))}
            </dl>
          </section>
        )}

        <section>
          <h2 className="mb-4 text-lg font-medium text-zinc-200">
            Charts
          </h2>
          <CatalogChartsLazy systemId={body.systemId} focusId={body.id} />
        </section>
      </div>
    </AppShell>
  );
}
