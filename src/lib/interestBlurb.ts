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
    /^.+ is a (?:planet|dwarf planet|asteroid|comet|star)\.?$/i.test(trimmed[0]!)
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


function formatDistanceLy(ly: number): string {
  if (!Number.isFinite(ly) || ly < 0) return "";
  if (ly < 10) return `${Number(ly.toPrecision(2))} ly`;
  if (ly < 100) return `${Number(ly.toPrecision(3))} ly`;
  if (ly < 1000) return `${Math.round(ly)} ly`;
  return `${Math.round(ly).toLocaleString("en-US")} ly`;
}

function earliestPlanetDiscovery(bodies: Body[]): {
  date: string;
  notes?: string;
} | null {
  let best: { year: number; date: string; notes?: string } | null = null;
  for (const b of bodies) {
    if (b.kind !== "planet" && b.kind !== "dwarf_planet") continue;
    const raw = b.facts.discoveryDate?.trim();
    if (!raw) continue;
    const m = /^(\d{4})/.exec(raw);
    if (!m) continue;
    const year = Number(m[1]);
    if (!Number.isFinite(year)) continue;
    if (!best || year < best.year) {
      const notes = b.facts.discoveryNotes?.trim();
      best = {
        year,
        date: raw,
        notes: notes && !isMetaDiscoveryNotes(notes) ? notes : undefined,
      };
    }
  }
  return best;
}

/**
 * System overview for SystemFacts (map overlay + Explore empty selection).
 * Prefer hand / ingest `system.blurb` when factual; else compose from catalog fields
 * and optional member bodies (earliest planet discovery). Never invent.
 */
export function systemOverviewBlurb(
  system: System,
  bodies?: Body[] | null,
): string | null {
  const hand = system.blurb?.trim();
  if (hand && !isMetaDiscoveryNotes(hand)) return hand;

  const sentences: string[] = [];
  const spectral = system.hostSpectralType?.trim();
  const nPlanets = system.planetCount;
  const nStars = system.starCount;
  const dist = system.distanceLy;

  const planetBit =
    nPlanets != null && nPlanets > 0
      ? `${nPlanets} confirmed planet${nPlanets === 1 ? "" : "s"}`
      : null;

  if (spectral && planetBit) {
    if (nStars != null && nStars >= 2) {
      sentences.push(
        `${system.name} is a ${spectral} multi-star system (${nStars} stars) with ${planetBit}.`,
      );
    } else {
      sentences.push(`${system.name} is a ${spectral} system with ${planetBit}.`);
    }
  } else if (spectral) {
    if (nStars != null && nStars >= 2) {
      sentences.push(
        `${system.name} is a ${spectral} multi-star system (${nStars} stars).`,
      );
    } else {
      sentences.push(`${system.name} is a ${spectral} system.`);
    }
  } else if (planetBit) {
    if (nStars != null && nStars >= 2) {
      sentences.push(
        `${system.name} is a multi-star system (${nStars} stars) with ${planetBit}.`,
      );
    } else {
      sentences.push(`${system.name} hosts ${planetBit}.`);
    }
  } else if (nStars != null && nStars >= 2) {
    sentences.push(`${system.name} is a multi-star system (${nStars} stars).`);
  }

  if (dist != null && Number.isFinite(dist) && dist > 0 && sentences.length < 3) {
    sentences.push(`About ${formatDistanceLy(dist)} from the Sun.`);
  }

  if (bodies && bodies.length > 0 && sentences.length < 3) {
    const first = earliestPlanetDiscovery(bodies);
    if (first) {
      const method =
        first.notes &&
        /\(([^)]+)\)\.?\s*$/.exec(first.notes.replace(/\s+/g, " ").trim());
      const when = formatDiscoveryDate(first.date);
      sentences.push(
        method
          ? `First planet discovered ${when} (${method[1]}).`
          : `First planet discovered ${when}.`,
      );
    }
  } else if (
    system.hasGas === true &&
    sentences.length < 3 &&
    !sentences.some((s) => /gas giant/i.test(s))
  ) {
    sentences.push("Includes at least one gas giant.");
  }

  const text = sentences
    .slice(0, 3)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  // Skip near-empty “X is a system.”
  if (/^.+ is a system\.?$/i.test(text)) return null;
  return text;
}
