import Link from "next/link";
import { AppShell } from "@/components/ui/AppShell";
import { BodyRail } from "@/components/ui/BodyRail";
import { bodies, KIND_LABEL } from "@/data/catalog";
import { CatalogCharts } from "@/viz/charts";

export default function SearchPage() {
  return (
    <AppShell rail={<BodyRail />}>
      <div className="mx-auto max-w-6xl space-y-8 p-6">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            Search the Solar System
          </h1>
          <p className="mt-2 max-w-2xl text-zinc-400">
            Phase 1 catalog: Sun, eight planets, Pluto, and four large
            asteroids. Use the search bar or browse the rail. Switch to{" "}
            <Link href="/discover" className="text-sky-400 hover:underline">
              Discover
            </Link>{" "}
            to compare, or{" "}
            <Link href="/explore" className="text-sky-400 hover:underline">
              Explore
            </Link>{" "}
            for lightweight 3D orbits.
          </p>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {bodies.map((b) => (
            <Link
              key={b.id}
              href={`/body/${b.id}`}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-sky-500/30 hover:bg-sky-500/5"
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ background: b.color ?? "#888" }}
              />
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-100">{b.name}</p>
                <p className="text-xs text-zinc-500">{KIND_LABEL[b.kind]}</p>
              </div>
            </Link>
          ))}
        </section>

        <section>
          <h2 className="mb-4 text-lg font-medium text-zinc-200">
            Catalog graphs
          </h2>
          <CatalogCharts />
        </section>
      </div>
    </AppShell>
  );
}
