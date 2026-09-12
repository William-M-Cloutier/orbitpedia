import type { Body } from "@/data/schema";

export type SatelliteFactRow = { label: string; value: string };

function formatSatDate(raw: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
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
  return raw.trim();
}

/**
 * Satellite Facts rows — owner / launch / expected reentry.
 * Omit any unknown. Factual catalog fields only.
 */
export function satelliteFactRows(body: Body): SatelliteFactRow[] {
  if (body.kind !== "satellite") return [];
  const rows: SatelliteFactRow[] = [];
  const owner = body.facts.owner?.trim();
  if (owner) rows.push({ label: "Owner", value: owner });
  const launch = body.facts.launchDate?.trim();
  if (launch) rows.push({ label: "Launch", value: formatSatDate(launch) });
  const reentry = body.facts.expectedReentry?.trim();
  if (reentry) {
    rows.push({ label: "Expected reentry", value: formatSatDate(reentry) });
  }
  return rows;
}
