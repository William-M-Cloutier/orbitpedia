import { Suspense } from "react";
import { bodies, getBody } from "@/data/catalog";
import { BodyDetailView } from "@/components/ui/BodyDetailView";
import { ArchiveBodyClient } from "./ArchiveBodyClient";

type Props = { params: Promise<{ id: string }> };

/** Curated bodies only — archive ids resolve dynamically via client bridge. */
export function generateStaticParams() {
  return bodies.map((b) => ({ id: b.id }));
}

export const dynamicParams = true;

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const body = getBody(id);
  return {
    title: body ? `${body.name} · Orbitpedia` : `${id} · Orbitpedia`,
  };
}

export default async function BodyPage({ params }: Props) {
  const { id } = await params;
  const curated = getBody(id);
  if (curated) {
    return <BodyDetailView body={curated} />;
  }

  // Archive / unknown at build time — never 404; lazy resolve on client.
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-zinc-500">Loading body…</div>
      }
    >
      <ArchiveBodyClient bodyId={id} />
    </Suspense>
  );
}
