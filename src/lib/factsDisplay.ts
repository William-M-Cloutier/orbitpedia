import type { Body, BodyKind } from "@/data/schema";
import {
  formatDensity,
  formatMass,
  formatPeriodDays,
  formatRadius,
} from "@/lib/units";

/** Fact keys the UI treats as expected for a kind (show muted Unknown if missing). */
const EXPECTED_BY_KIND: Record<BodyKind, ReadonlySet<string>> = {
  star: new Set(["massKg", "radiusMeanKm"]),
  black_hole: new Set(["massKg", "radiusMeanKm"]),
  planet: new Set(["massKg", "radiusMeanKm"]),
  dwarf_planet: new Set(["massKg", "radiusMeanKm"]),
  /** Radius preferred; mass often unknown — omit mass row when missing. */
  asteroid: new Set(["radiusMeanKm"]),
  moon: new Set(["radiusMeanKm"]),
  /** Artificial sats: owner/launch shown separately; phys often sparse. */
  satellite: new Set([]),
  /** Mission fields live on body.mission — no SI expected set. */
  probe: new Set(),
};

export type FactKey =
  | "massKg"
  | "radiusMeanKm"
  | "densityGcm3"
  | "rotationPeriodD"
  | "albedo";

export type FactRow = {
  key: FactKey;
  label: string;
  /** Display string; null means omit the row entirely. */
  value: string | null;
  /** True when showing honest Unknown for an expected-by-kind gap. */
  unknown?: boolean;
  /** Optional short reason (e.g. upper bound only) under Unknown. */
  reason?: string;
  /** True when value is marked approximate (~). */
  approximate?: boolean;
};

function isApproximate(body: Body, field: FactKey): boolean {
  const list = body.facts.approximateFields;
  return Array.isArray(list) && list.includes(field);
}

function withApprox(text: string, approx: boolean): string {
  if (!approx) return text;
  return text.startsWith("~") ? text : `~${text}`;
}

/**
 * Short reason under Unknown — only when there is a specific story.
 * Omit generic restatements of unknown (no "not in catalog" / "unavailable").
 */
export function unknownReason(body: Body, field: FactKey): string | undefined {
  const notes = body.facts.discoveryNotes ?? "";
  const source = body.meta.source ?? body.meta.provenance ?? "";
  const blob = `${notes} ${source}`;
  if (field === "massKg" && /upper\s*bound/i.test(blob)) {
    return "upper bound only";
  }
  return undefined;
}

const EMPTY_EXPECTED: ReadonlySet<string> = new Set();

/** True when this kind expects the field (Unknown if missing). Unknown kinds → false. */
export function isExpectedFact(kind: BodyKind, field: FactKey): boolean {
  return (EXPECTED_BY_KIND[kind] ?? EMPTY_EXPECTED).has(field);
}

/**
 * Build a fact row: value when present; muted Unknown only if expected-by-kind;
 * otherwise omit (null value). Never invent zeros.
 */
export function factRow(
  body: Body,
  field: FactKey,
  label: string,
  raw: number | null | undefined,
  format: (n: number) => string,
): FactRow {
  if (raw != null && Number.isFinite(raw)) {
    const approx = isApproximate(body, field);
    return {
      key: field,
      label,
      value: withApprox(format(raw), approx),
      approximate: approx || undefined,
    };
  }
  if (isExpectedFact(body.kind, field)) {
    return {
      key: field,
      label,
      value: "Unknown",
      unknown: true,
      reason: unknownReason(body, field),
    };
  }
  return { key: field, label, value: null };
}

export function massFactRow(body: Body): FactRow {
  return factRow(body, "massKg", "Mass", body.facts.massKg, formatMass);
}

export function radiusFactRow(body: Body): FactRow {
  return factRow(
    body,
    "radiusMeanKm",
    "Mean radius",
    body.facts.radiusMeanKm,
    formatRadius,
  );
}

export function densityFactRow(body: Body): FactRow {
  return factRow(
    body,
    "densityGcm3",
    "Density",
    body.facts.densityGcm3,
    formatDensity,
  );
}

export function rotationFactRow(body: Body): FactRow {
  const r = body.facts.rotationPeriodD;
  if (r != null && Number.isFinite(r)) {
    const text =
      formatPeriodDays(Math.abs(r)) + (r < 0 ? " (retrograde)" : "");
    const approx = isApproximate(body, "rotationPeriodD");
    return {
      key: "rotationPeriodD",
      label: "Rotation period",
      value: withApprox(text, approx),
      approximate: approx || undefined,
    };
  }
  // Rotation is optional for all kinds — omit when missing.
  return { key: "rotationPeriodD", label: "Rotation period", value: null };
}

export function albedoFactRow(body: Body): FactRow {
  return factRow(body, "albedo", "Albedo", body.facts.albedo, (n) =>
    n.toPrecision(3),
  );
}

/** Compact Quick Facts: discovered + expected phys + orbit when present. */
export function quickPhysFactRows(body: Body): FactRow[] {
  return [massFactRow(body), radiusFactRow(body)].filter((r) => r.value != null);
}

/** Full Key facts panel / body page. */
export function keyFactRows(body: Body): FactRow[] {
  return [
    massFactRow(body),
    radiusFactRow(body),
    densityFactRow(body),
    rotationFactRow(body),
    albedoFactRow(body),
  ].filter((r) => r.value != null);
}
