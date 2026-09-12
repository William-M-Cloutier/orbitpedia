"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/ui/AppShell";
import { BodyDetailView } from "@/components/ui/BodyDetailView";
import { getBody } from "@/data/catalog";
import { getBodyAsync } from "@/data/archiveCatalog";
import type { Body } from "@/data/schema";

type Props = { bodyId: string };

/**
 * Client bridge for archive (and other lazy) body ids that are not in
 * curated generateStaticParams. Resolves via getSystemGraphAsync / getBodyAsync.
 */
export function ArchiveBodyClient({ bodyId }: Props) {
  const searchParams = useSearchParams();
  const systemHint = searchParams.get("system")?.trim() || undefined;
  const [body, setBody] = useState<Body | undefined>(() => getBody(bodyId));
  const [status, setStatus] = useState<"loading" | "ready" | "missing">(
    () => (getBody(bodyId) ? "ready" : "loading"),
  );

  useEffect(() => {
    let cancelled = false;
    const cached = getBody(bodyId);
    if (cached) {
      setBody(cached);
      setStatus("ready");
      return;
    }
    setStatus("loading");
    getBodyAsync(bodyId, systemHint).then((b) => {
      if (cancelled) return;
      if (b) {
        setBody(b);
        setStatus("ready");
      } else {
        setBody(undefined);
        setStatus("missing");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bodyId, systemHint]);

  if (status === "loading") {
    return (
      <AppShell>
        <div className="p-6 text-sm text-zinc-500">Loading body…</div>
      </AppShell>
    );
  }

  if (status === "missing" || !body) {
    return (
      <AppShell>
        <div className="mx-auto max-w-lg space-y-3 p-6">
          <h1 className="text-xl font-medium text-zinc-100">Body not found</h1>
          <p className="text-sm text-zinc-500">
            Nothing matches{" "}
            <code className="text-zinc-300">{bodyId}</code>
            {systemHint ? (
              <>
                {" "}
                in system{" "}
                <code className="text-zinc-300">{systemHint}</code>
              </>
            ) : null}
            .
          </p>
        </div>
      </AppShell>
    );
  }

  return <BodyDetailView body={body} />;
}
