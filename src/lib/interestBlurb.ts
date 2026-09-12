import { KIND_LABEL, getBody, getSystem } from "@/data/catalog";
import type { Body, System } from "@/data/schema";
import {
  EARTH_MASS_KG,
  EARTH_RADIUS_KM,
  kgToEarthMasses,
  kmToEarthRadii,
} from "@/lib/units";

/**
 * Overview blurbs from card fields only — never invent discoveries or claims.
 *
 * Future: optional Wikipedia summary hook (runtime fetch / cite; never bulk-dump
 * verbatim encyclopedia text into the repo).
 */

const META_NOTES_RE =
  /\b(ui fixture|placeholder|ingest|sparse|phase\s*1|not a real|store b|fail-open|hand-enriched|wired to archive|sample ingest|orbitpedia catalog)\b/i;

export function isMetaDiscoveryNotes(notes: string): boolean {
  const t = notes.trim();
  if (!t) return true;
  return META_NOTES_RE.test(t);
}

function formatDiscoveryDate(raw: string): string {
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

function earthCompareSentence(body: Body): string | null {
  const parts: string[] = [];
  const rKm = body.facts.radiusMeanKm;
  const mKg = body.facts.massKg;
  if (rKm != null && Number.isFinite(rKm) && rKm >= 0.05 * EARTH_RADIUS_KM) {
    parts.push(`${kmToEarthRadii(rKm).toPrecision(3)} R⊕`);
  }
  if (
    mKg != null &&
    Number.isFinite(mKg) &&
    mKg >= 0.01 * EARTH_MASS_KG &&
    mKg < EARTH_MASS_KG * 5000
  ) {
    parts.push(`${kgToEarthMasses(mKg).toPrecision(3)} M⊕`);
  }
  if (!parts.length) return null;
  return `About ${parts.join(" and ")}.`;
}

function starCompareSentence(body: Body): string | null {
  const parts: string[] = [];
  const mKg = body.facts.massKg;
  const rKm = body.facts.radiusMeanKm;
  if (mKg != null && Number.isFinite(mKg) && mKg > 0) {
    const ms = mKg / 1.988_47e30;
    if (ms >= 0.01) parts.push(`${ms.toPrecision(3)} M☉`);
  }
  if (rKm != null && Number.isFinite(rKm) && rKm > 0) {
    const rs = rKm / 695_700;
    if (rs >= 0.05) parts.push(`${rs.toPrecision(3)} R☉`);
  }
  if (!parts.length) return null;
  return `Roughly ${parts.join(" and ")}.`;
}

function identitySentence(body: Body, sys: System | null): string {
  const kindLabel = KIND_LABEL[body.kind] ?? body.kind;
  if (body.kind === "moon" && body.parentId) {
    const parent = getBody(body.parentId);
    return parent
      ? `${body.name} is a moon of ${parent.name}.`
      : `${body.name} is a moon.`;
  }
  if (body.kind === "star") {
    if (body.parentId) {
      const host = getBody(body.parentId);
      return host
        ? `${body.name} is a companion star to ${host.name}.`
        : `${body.name} is a companion star.`;
    }
    const spectral = sys?.hostSpectralType?.trim();
    const nPlanets = sys?.planetCount;
    if (spectral && nPlanets != null && nPlanets > 0) {
      return `${body.name} is a ${spectral} star hosting ${nPlanets} confirmed planet${nPlanets === 1 ? "" : "s"}.`;
    }
    if (spectral) return `${body.name} is a ${spectral} star.`;
    if (nPlanets != null && nPlanets > 0) {
      return `${body.name} hosts ${nPlanets} confirmed planet${nPlanets === 1 ? "" : "s"}.`;
    }
    return `${body.name} is a star.`;
  }
  if (sys && !sys.home) {
    return `${body.name} is a ${kindLabel.toLowerCase()} in the ${sys.name} system.`;
  }
  return `${body.name} is a ${kindLabel.toLowerCase()}.`;
}

export function interestBlurb(
  body: Body,
  system?: System | null,
): string | null {
  const sys = system ?? getSystem(body.systemId) ?? null;
  const sentences: string[] = [];
  sentences.push(identitySentence(body, sys));
  const date = body.facts.discoveryDate?.trim();
  if (date) {
    if (body.kind !== "star") {
      sentences.push(`Discovered ${formatDiscoveryDate(date)}.`);
    } else if (body.parentId) {
      sentences.push(`First listed ${formatDiscoveryDate(date)}.`);
    }
  }
  if (sys && sentences.length < 3) {
    const starCount = sys.starCount;
    if (starCount != null && starCount >= 2) {
      if (body.kind === "planet" || body.kind === "dwarf_planet") {
        sentences.push(
          body.parentId
            ? `The ${sys.name} system has ${starCount} stars.`
            : `It orbits in a multi-star system (${starCount} stars).`,
        );
      } else if (body.kind === "star" && !body.parentId) {
        sentences.push(`Multi-star system with ${starCount} stars.`);
      }
    } else if (sys.hasGas === true && body.kind === "star" && !body.parentId) {
      sentences.push("The system includes at least one gas giant.");
    }
  }
  if (sentences.length < 3) {
    if (body.kind === "star") {
      const size = starCompareSentence(body);
      if (size) sentences.push(size);
    } else if (
      body.kind === "planet" ||
      body.kind === "dwarf_planet" ||
      body.kind === "moon"
    ) {
      const size = earthCompareSentence(body);
      if (size) sentences.push(size);
    }
  }
  if (
    sentences.length < 3 &&
    sys?.hasGas === true &&
    body.kind === "star" &&
    !body.parentId &&
    !sentences.some((s) => /gas giant/i.test(s))
  ) {
    sentences.push("The system includes at least one gas giant.");
  }
  const trimmed = sentences.slice(0, 3);
  if (
    trimmed.length === 1 &&
    /^.+ is a (?:planet|dwarf planet|asteroid|star)\.?$/i.test(trimmed[0]!)
  ) {
    return null;
  }
  const text = trimmed.join(" ").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

export function overviewBlurb(
  body: Body,
  system?: System | null,
): string | null {
  const notes = body.facts.discoveryNotes?.trim();
  if (notes && !isMetaDiscoveryNotes(notes)) return notes;
  return interestBlurb(body, system);
}
