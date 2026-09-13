import type { Body } from "@/data/schema";
import { EARTH_RADIUS_KM } from "@/lib/units";

export type SatelliteFactRow = { label: string; value: string };

/** Mean Earth radius (km) — altitude = a − Re for near-circular GP elements. */
const RE_KM = EARTH_RADIUS_KM;

/** GEO semi-major axis ≈ 42_164 km (period ≈ 1 sidereal day). */
const GEO_A_KM = 42_164;
/** LEO / MEO split on mean altitude (km). */
const LEO_ALT_MAX_KM = 2_000;
/** Sun-synchronous LEO inclination band (deg). */
const SSO_I_MIN_DEG = 96;
const SSO_I_MAX_DEG = 100;
/** Eccentricity floor for HEO when altitude alone is ambiguous. */
const HEO_E_MIN = 0.25;

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
 * Factual orbit regime from catalog Kepler/GP elements — omit when unknown.
 * LEO / SSO / MEO / GEO / HEO only; never invent beyond aKm, periodD, iDeg, e.
 */
export function satelliteOrbitRegime(body: Body): string | null {
  if (body.kind !== "satellite") return null;
  const o = body.orbit;
  if (!o || o.frame !== "geocentric") return null;
  const aKm = o.aKm;
  if (aKm == null || !(aKm > RE_KM)) return null;
  const e = Number.isFinite(o.e) ? o.e : 0;
  const iDeg = Number.isFinite(o.iDeg) ? o.iDeg : null;
  const periodD = o.periodD;

  const periKm = aKm * (1 - e);
  const apoKm = aKm * (1 + e);
  const meanAltKm = aKm - RE_KM;
  const periAltKm = periKm - RE_KM;
  const apoAltKm = apoKm - RE_KM;

  // HEO: clearly elliptical with high apogee (Molniya-class etc.).
  if (e >= HEO_E_MIN && apoAltKm > LEO_ALT_MAX_KM) {
    return "HEO";
  }

  // GEO: semi-major near geostationary belt and/or ~1 day period.
  const nearGeoA = Math.abs(aKm - GEO_A_KM) / GEO_A_KM < 0.03;
  const nearGeoP =
    periodD != null &&
    Number.isFinite(periodD) &&
    Math.abs(periodD - 0.997) < 0.05;
  if (nearGeoA || nearGeoP) {
    if (iDeg != null && Math.abs(iDeg) < 5 && e < 0.05) return "GEO";
    return "GEO"; // geosynchronous belt — still label GEO for Facts brevity
  }

  if (meanAltKm < LEO_ALT_MAX_KM && periAltKm > -50) {
    if (
      iDeg != null &&
      iDeg >= SSO_I_MIN_DEG &&
      iDeg <= SSO_I_MAX_DEG
    ) {
      return "SSO";
    }
    return "LEO";
  }

  if (meanAltKm < GEO_A_KM - RE_KM - 500) {
    return "MEO";
  }

  // Above MEO, not GEO-matched — high Earth / HEO-ish without high e.
  if (e >= 0.1) return "HEO";
  return null;
}

/**
 * Satellite Facts rows — owner / launch / orbit / expected reentry.
 * Omit any unknown. Factual catalog fields only.
 */
export function satelliteFactRows(body: Body): SatelliteFactRow[] {
  if (body.kind !== "satellite") return [];
  const rows: SatelliteFactRow[] = [];
  const owner = body.facts.owner?.trim();
  if (owner) rows.push({ label: "Owner", value: owner });
  const launch = body.facts.launchDate?.trim();
  if (launch) rows.push({ label: "Launch", value: formatSatDate(launch) });
  const regime = satelliteOrbitRegime(body);
  if (regime) rows.push({ label: "Orbit", value: regime });
  const reentry = body.facts.expectedReentry?.trim();
  if (reentry) {
    rows.push({ label: "Expected reentry", value: formatSatDate(reentry) });
  }
  return rows;
}
