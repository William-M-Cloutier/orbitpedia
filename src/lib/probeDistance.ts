import type { Body } from "@/data/schema";

export type ProbeDistPoint = {
  jd: number;
  date?: string;
  earthDistAu: number;
};

/** Honest earthDistAu samples from path.waypoints — never invent. */
export function probeEarthDistanceSeries(body: Body): ProbeDistPoint[] {
  if (body.kind !== "probe") return [];
  const wps = body.path?.waypoints;
  if (!wps || wps.length < 2) return [];
  const out: ProbeDistPoint[] = [];
  for (const w of wps) {
    const d = w.earthDistAu;
    if (d == null || !Number.isFinite(d) || d < 0) continue;
    let jd = w.jd;
    if (jd == null || !Number.isFinite(jd)) {
      const iso = w.date?.trim();
      if (!iso) continue;
      const t = Date.parse(`${iso}T00:00:00Z`);
      if (!Number.isFinite(t)) continue;
      // JD ≈ Unix/86400 + 2440587.5
      jd = t / 86_400_000 + 2_440_587.5;
    }
    out.push({
      jd,
      date: w.date?.trim() || undefined,
      earthDistAu: d,
    });
  }
  out.sort((a, b) => a.jd - b.jd);
  return out.length >= 2 ? out : [];
}

export function formatJdYear(jd: number): string {
  // Inverse of Unix→JD used above
  const ms = (jd - 2_440_587.5) * 86_400_000;
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return String(Math.round(jd));
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
