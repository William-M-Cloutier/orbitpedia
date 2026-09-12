import type { Body } from "@/data/schema";

/** Known mission.status tokens → short Facts labels. Else title-case underscores. */
const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  en_route: "En route",
  heliopause: "Heliopause",
  flyby_complete: "Flyby complete",
};

export function formatMissionDate(raw: string): string {
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

export function formatMissionStatus(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (STATUS_LABEL[key]) return STATUS_LABEL[key]!;
  return raw
    .trim()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export type MissionFactRow = { label: string; value: string };

/** Launch / status / targets — omit any unknown. Factual catalog fields only. */
export function missionFactRows(body: Body): MissionFactRow[] {
  const m = body.mission;
  if (!m) return [];
  const rows: MissionFactRow[] = [];
  const launch = m.launchDate?.trim();
  if (launch) rows.push({ label: "Launch", value: formatMissionDate(launch) });
  const status = m.status?.trim();
  if (status) rows.push({ label: "Status", value: formatMissionStatus(status) });
  const targets = m.targets?.map((t) => t.trim()).filter(Boolean);
  if (targets && targets.length > 0) {
    rows.push({ label: "Targets", value: targets.join(" · ") });
  }
  return rows;
}

export function hasMissionFacts(body: Body): boolean {
  return missionFactRows(body).length > 0;
}
