import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/ui/AppShell";
import { BodyRail } from "@/components/ui/BodyRail";
import { bodies, getBody, KIND_LABEL } from "@/data/catalog";
import { bodyProvenance } from "@/data/schema";
import { periodFromA } from "@/lib/kepler";
import {
  formatAu,
  formatDensity,
  formatMass,
  formatPeriodDays,
  formatRadius,
} from "@/lib/units";
import { CatalogChartsLazy } from "@/viz/CatalogChartsLazy";

type Props = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return bodies.map((b) => ({ id: b.id }));
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const body = getBody(id);
  return {
    title: body ? `${body.name} · Orbitpedia` : "Body · Orbitpedia",
  };
}

export default async function BodyPage({ params }: Props) {
  const { id } = await params;
  const body = getBody(id);
  if (!body) notFound();

  const period =
    body.orbit?.periodD ??
    (body.orbit ? periodFromA(body.orbit.aAu) : undefined);

  return (
    <AppShell rail={<BodyRail activeId={body.id} />}>
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
                {body.aliases?.length
                  ? ` · also ${body.aliases.join(", ")}`
                  : ""}
              </p>
            </div>
          </div>
          <Link
            href={`/?focus=${encodeURIComponent(body.id)}`}
            className="rounded-lg bg-sky-500/20 px-4 py-2 text-sm text-sky-200 hover:bg-sky-500/30"
          >
            Open in Explore →
          </Link>
        </div>

        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
            Overview
          </h2>
          <p className="text-zinc-300">
            {body.facts.discoveryNotes ??
              `${body.name} is a ${KIND_LABEL[body.kind].toLowerCase()} in the Orbitpedia Phase 1 catalog.`}
          </p>
          <p className="mt-2 text-xs text-zinc-600">
            Source: {bodyProvenance(body)}
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-medium text-zinc-200">Key facts</h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            {(
              [
                [
                  "Mass",
                  body.facts.massKg != null
                    ? formatMass(body.facts.massKg)
                    : null,
                ],
                [
                  "Mean radius",
                  body.facts.radiusMeanKm != null
                    ? formatRadius(body.facts.radiusMeanKm)
                    : null,
                ],
                [
                  "Density",
                  body.facts.densityGcm3 != null
                    ? formatDensity(body.facts.densityGcm3)
                    : null,
                ],
                [
                  "Rotation period",
                  body.facts.rotationPeriodD != null
                    ? formatPeriodDays(Math.abs(body.facts.rotationPeriodD)) +
                      (body.facts.rotationPeriodD < 0 ? " (retrograde)" : "")
                    : null,
                ],
                [
                  "Albedo",
                  body.facts.albedo != null
                    ? body.facts.albedo.toPrecision(3)
                    : null,
                ],
              ] as Array<[string, string | null]>
            )
              .filter(([, v]) => v != null)
              .map(([k, v]) => (
                <div
                  key={k}
                  className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3"
                >
                  <dt className="text-xs text-zinc-500">{k}</dt>
                  <dd className="mt-0.5 text-zinc-100">{v}</dd>
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
            Catalog graphs
          </h2>
          <CatalogChartsLazy />
        </section>
      </div>
    </AppShell>
  );
}
