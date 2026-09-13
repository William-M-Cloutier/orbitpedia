#!/usr/bin/env python3
"""Fetch dense Horizons VECTORS for Orbitpedia probe path.waypoints.

Samples each probe's full mission span (~40–100 waypoints, cap ~120),
force-includes milestone dates/labels, parses ALL $$SOE..$$EOE vectors,
writes waypoints-parsed.json, and applies path.waypoints into body cards.

Provenance: CENTER=500@10 Sun, REF_PLANE=ECLIPTIC, OUT_UNITS=AU-D;
earthDistAu from CENTER=500@399 at the same epochs. Never invents coordinates.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "horizons-probes"
FIXTURES.mkdir(parents=True, exist_ok=True)
OUT = FIXTURES / "waypoints-parsed.json"
BODIES = ROOT / "src" / "data" / "bodies"

# Target waypoint density (before milestone merges); hard cap after merge.
TARGET_COUNT = 70
MIN_COUNT = 40
MAX_COUNT = 120

# (id, horizon_cmd, [(date, label), ...])
# Dates are mission milestones; launch/end may be nudged when Horizons has no
# midnight sample (see resolve_available_day).
PROBES = [
    (
        "voyager-1",
        "-31",
        [
            ("1977-09-05", "launch"),
            ("1979-03-05", "jupiter"),
            ("1980-11-12", "saturn"),
            ("2012-08-25", "heliopause"),
            ("2026-09-12", "recent"),
        ],
    ),
    (
        "voyager-2",
        "-32",
        [
            ("1977-08-20", "launch"),
            ("1979-07-09", "jupiter"),
            ("1981-08-25", "saturn"),
            ("1986-01-24", "uranus"),
            ("1989-08-25", "neptune"),
            ("2026-09-12", "recent"),
        ],
    ),
    (
        "new-horizons",
        "-98",
        [
            ("2006-01-19", "launch"),
            ("2007-02-28", "jupiter"),
            ("2015-07-14", "pluto"),
            ("2019-01-01", "arrokoth"),
            ("2026-09-12", "recent"),
        ],
    ),
    (
        "pioneer-10",
        "-23",
        [
            ("1972-03-03", "launch"),
            ("1973-12-04", "jupiter"),
            ("2003-01-23", "last_signal"),
        ],
    ),
    (
        "pioneer-11",
        "-24",
        [
            ("1973-04-06", "launch"),
            ("1974-12-03", "jupiter"),
            ("1979-09-01", "saturn"),
            ("1995-09-30", "late"),
        ],
    ),
    (
        "galileo",
        "-77",
        [
            ("1989-10-18", "launch"),
            ("1990-02-10", "venus"),
            ("1992-12-08", "earth2"),
            ("1995-12-07", "joi"),
            ("2003-09-21", "impact"),
        ],
    ),
    (
        "cassini",
        "-82",
        [
            ("1997-10-15", "launch"),
            ("2000-12-30", "jupiter"),
            ("2004-07-01", "soi"),
            ("2017-09-15", "finale"),
        ],
    ),
    (
        "juno",
        "-61",
        [
            ("2011-08-05", "launch"),
            ("2013-10-09", "earth"),
            ("2016-07-05", "joi"),
            ("2026-09-12", "recent"),
        ],
    ),
    (
        "perseverance",
        "-168",
        [
            ("2020-07-30", "launch"),
            ("2020-09-15", "cruise1"),
            ("2020-11-15", "cruise2"),
            ("2021-01-15", "cruise3"),
            ("2021-02-18", "landing"),
        ],
    ),
]

MONTHS = {
    "Jan": 1,
    "Feb": 2,
    "Mar": 3,
    "Apr": 4,
    "May": 5,
    "Jun": 6,
    "Jul": 7,
    "Aug": 8,
    "Sep": 9,
    "Oct": 10,
    "Nov": 11,
    "Dec": 12,
}

PRIOR_RE = re.compile(
    r"No ephemeris for target[^\n]*prior to A\.D\.\s*"
    r"(?P<y>\d{4})-(?P<mon>[A-Za-z]{3})-(?P<d>\d{1,2})\s+"
    r"(?P<h>\d{2}):(?P<mi>\d{2}):(?P<s>\d{2})",
    re.IGNORECASE,
)
AFTER_RE = re.compile(
    r"No ephemeris for target[^\n]*after A\.D\.\s*"
    r"(?P<y>\d{4})-(?P<mon>[A-Za-z]{3})-(?P<d>\d{1,2})\s+"
    r"(?P<h>\d{2}):(?P<mi>\d{2}):(?P<s>\d{2})",
    re.IGNORECASE,
)

VEC_RE = re.compile(
    r"(?P<jd>\d+\.\d+)\s*=\s*A\.D\.\s*(?P<label>[^\n]+)\n"
    r"\s*X\s*=\s*(?P<x>[+\-]?\d+\.\d+E[+\-]\d+)\s*"
    r"Y\s*=\s*(?P<y>[+\-]?\d+\.\d+E[+\-]\d+)\s*"
    r"Z\s*=\s*(?P<z>[+\-]?\d+\.\d+E[+\-]\d+)",
    re.MULTILINE,
)

HORIZONS_DATE_RE = re.compile(
    r"(?P<y>\d{4})-(?P<mon>[A-Za-z]{3})-(?P<d>\d{1,2})(?:\s+(?P<h>\d{2}):(?P<mi>\d{2}))?"
)


def horizons_url(command: str, center: str, start: str, stop: str, step: str) -> str:
    params = {
        "format": "text",
        "COMMAND": f"'{command}'",
        "EPHEM_TYPE": "'VECTORS'",
        "CENTER": f"'{center}'",
        "START_TIME": f"'{start}'",
        "STOP_TIME": f"'{stop}'",
        "STEP_SIZE": f"'{step}'",
        "VEC_TABLE": "'2'",
        "REF_PLANE": "'ECLIPTIC'",
        "OUT_UNITS": "'AU-D'",
        "OBJ_DATA": "'NO'",
    }
    return "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(params)


def parse_iso_date(iso: str) -> dt.date:
    return dt.date.fromisoformat(iso[:10])


def add_days(iso: str, days: int) -> str:
    return (parse_iso_date(iso) + dt.timedelta(days=days)).isoformat()


def mon_to_num(mon: str) -> int:
    key = mon[:3].title()
    if key not in MONTHS:
        raise ValueError(f"unknown month {mon!r}")
    return MONTHS[key]


def horizons_label_to_iso(label: str) -> str:
    m = HORIZONS_DATE_RE.search(label)
    if not m:
        raise ValueError(f"cannot parse Horizons date from {label!r}")
    return f"{int(m.group('y')):04d}-{mon_to_num(m.group('mon')):02d}-{int(m.group('d')):02d}"


def fetch(url: str, cache_path: Path) -> str:
    if cache_path.exists() and cache_path.stat().st_size > 200:
        cached = cache_path.read_text(encoding="utf-8", errors="replace")
        # Reuse only successful ephemeris payloads (avoid sticky error stubs).
        if "$$SOE" in cached and "$$EOE" in cached:
            return cached
    req = urllib.request.Request(url, headers={"User-Agent": "Orbitpedia-ephemeris/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        text = resp.read().decode("utf-8", errors="replace")
    # Persist successes; also keep error text for debugging but small files won't be reused.
    cache_path.write_text(text, encoding="utf-8")
    time.sleep(0.4)  # be polite
    return text


def parse_all_vectors(text: str) -> list[dict]:
    if "$$SOE" not in text or "$$EOE" not in text:
        return []
    block = text.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    out: list[dict] = []
    for m in VEC_RE.finditer(block):
        label = m.group("label").strip()
        try:
            date = horizons_label_to_iso(label)
        except ValueError:
            continue
        out.append(
            {
                "jd": float(m.group("jd")),
                "xAu": float(m.group("x")),
                "yAu": float(m.group("y")),
                "zAu": float(m.group("z")),
                "horizonsLabel": label,
                "date": date,
            }
        )
    return out


def mag(x: float, y: float, z: float) -> float:
    return math.sqrt(x * x + y * y + z * z)


def choose_step_days(span_days: int) -> int:
    """Pick an integer day step for ~TARGET_COUNT samples, clamped to [MIN, MAX]."""
    if span_days <= 0:
        return 1
    # Prefer ~TARGET_COUNT inclusive samples → (count-1) intervals.
    step = max(1, round(span_days / max(1, TARGET_COUNT - 1)))
    count = span_days // step + 1
    if count > MAX_COUNT:
        step = max(1, math.ceil(span_days / (MAX_COUNT - 1)))
        count = span_days // step + 1
    if count < MIN_COUNT and span_days >= MIN_COUNT - 1:
        step = max(1, span_days // (MIN_COUNT - 1))
    return max(1, int(step))


def cache_name(probe_id: str, kind: str, start: str, stop: str, step: str, center: str) -> Path:
    safe_step = step.replace(" ", "")
    safe_start = start.replace(":", "").replace(" ", "T")
    safe_stop = stop.replace(":", "").replace(" ", "T")
    return FIXTURES / f"{probe_id}_{kind}_{safe_start}_{safe_stop}_{safe_step}_{center}.txt"


def fetch_vectors(
    probe_id: str,
    cmd: str,
    center: str,
    start: str,
    stop: str,
    step: str,
    kind: str,
) -> tuple[str, list[dict]]:
    center_tag = "sun" if center == "500@10" else "earth" if center == "500@399" else center.replace("@", "at")
    path = cache_name(probe_id, kind, start, stop, step, center_tag)
    url = horizons_url(cmd, center, start, stop, step)
    text = fetch(url, path)
    return text, parse_all_vectors(text)


def extract_bound_hint(text: str) -> tuple[str | None, str | None]:
    """Return (prior_iso_or_datetime, after_iso_or_datetime) hints from error text."""
    prior = None
    after = None
    m = PRIOR_RE.search(text)
    if m:
        prior = (
            f"{int(m.group('y')):04d}-{mon_to_num(m.group('mon')):02d}-{int(m.group('d')):02d}"
            f" {m.group('h')}:{m.group('mi')}:{m.group('s')}"
        )
    m = AFTER_RE.search(text)
    if m:
        after = (
            f"{int(m.group('y')):04d}-{mon_to_num(m.group('mon')):02d}-{int(m.group('d')):02d}"
            f" {m.group('h')}:{m.group('mi')}:{m.group('s')}"
        )
    return prior, after


def resolve_single_day(
    probe_id: str,
    cmd: str,
    date: str,
    label: str,
    failures: list,
) -> dict | None:
    """Fetch one day (sun+earth), nudging if Horizons rejects midnight."""
    attempts: list[str] = [date, add_days(date, 1), add_days(date, -1)]
    seen: set[str] = set()
    for start in attempts:
        if start in seen:
            continue
        seen.add(start)
        stop = add_days(start[:10], 1)
        sun_text, sun_vecs = fetch_vectors(probe_id, cmd, "500@10", start, stop, "1 d", f"ms_{label}")
        used_start = start
        if not sun_vecs:
            prior, after = extract_bound_hint(sun_text)
            if prior:
                p_date = prior[:10]
                hh, mm, ss = (prior[11:].split(":") + ["0", "0", "0"])[:3]
                minute = int(mm) + 1
                hour = int(hh) + (1 if minute >= 60 else 0)
                minute = minute % 60
                used_start = f"{p_date} {hour:02d}:{minute:02d}:{int(float(ss)):02d}"
                if used_start not in seen:
                    seen.add(used_start)
                    stop = add_days(p_date, 1)
                    sun_text, sun_vecs = fetch_vectors(
                        probe_id, cmd, "500@10", used_start, stop, "1 d", f"ms_{label}_prior"
                    )
            if not sun_vecs and after:
                continue
            if not sun_vecs:
                snippet = sun_text[:400].replace("\n", " | ")
                print(f"  FAIL milestone {date} ({label}): {snippet[:180]}", flush=True)
                failures.append({"probe": probe_id, "date": date, "label": label, "snippet": snippet[:400]})
                continue

        sun = sun_vecs[0]
        want = used_start[:10]
        for v in sun_vecs:
            if v["date"] == want:
                sun = v
                break

        # Earth must use the same start instant (midnight may be pre-coverage).
        earth_text, earth_vecs = fetch_vectors(
            probe_id, cmd, "500@399", used_start, stop, "1 d", f"ms_{label}"
        )
        earth_dist = None
        if earth_vecs:
            earth = earth_vecs[0]
            for ev in earth_vecs:
                if abs(ev["jd"] - sun["jd"]) < 1e-4:
                    earth = ev
                    break
                if ev["date"] == sun["date"]:
                    earth = ev
            earth_dist = mag(earth["xAu"], earth["yAu"], earth["zAu"])
        else:
            print(f"  WARN earth missing for milestone {sun['date']} ({label})", flush=True)
            failures.append({"probe": probe_id, "date": sun["date"], "center": "earth", "label": label})

        if earth_dist is None:
            # Cannot ship without earthDistAu — try next attempt.
            continue

        wp = {
            "date": sun["date"],
            "jd": sun["jd"],
            "xAu": sun["xAu"],
            "yAu": sun["yAu"],
            "zAu": sun["zAu"],
            "label": label,
            "earthDistAu": earth_dist,
            "queryStart": used_start,
        }
        print(
            f"  MS {wp['date']} ({label}): r={mag(wp['xAu'], wp['yAu'], wp['zAu']):.4f} au"
            f" earth={earth_dist:.4f}",
            flush=True,
        )
        return wp
    return None


def build_range_grid(start: str, stop: str, step_days: int) -> list[str]:
    s = parse_iso_date(start)
    e = parse_iso_date(stop)
    out = []
    cur = s
    while cur <= e:
        out.append(cur.isoformat())
        cur += dt.timedelta(days=step_days)
    if not out or out[-1] != e.isoformat():
        # ensure stop included in grid intent (actual force via milestones)
        pass
    return out


def densify_probe(probe_id: str, cmd: str, epochs: list[tuple[str, str]], failures: list) -> dict:
    print(f"=== {probe_id} ({cmd}) ===", flush=True)

    # Resolve each milestone first (labels + honest available days).
    milestone_wps: list[dict] = []
    for date, label in epochs:
        wp = resolve_single_day(probe_id, cmd, date, label, failures)
        if wp:
            milestone_wps.append(wp)

    if len(milestone_wps) < 2:
        print(f"  ERROR: fewer than 2 milestones for {probe_id}", flush=True)
        return {"horizonId": cmd, "waypoints": milestone_wps, "stepDays": None}

    # Use the actual Horizons-available start instant (launch days often need HH:MM).
    range_start = milestone_wps[0].get("queryStart") or milestone_wps[0]["date"]
    range_stop = milestone_wps[-1].get("queryStart") or milestone_wps[-1]["date"]
    # Calendar span still from dates:
    range_start_date = milestone_wps[0]["date"]
    range_stop_date = milestone_wps[-1]["date"]
    span = (parse_iso_date(range_stop_date) - parse_iso_date(range_start_date)).days
    step_days = choose_step_days(span)
    print(
        f"  range {range_start} → {range_stop} ({span} d), step={step_days} d "
        f"(target ~{TARGET_COUNT}, cap {MAX_COUNT})",
        flush=True,
    )

    # Prefer STOP == last milestone day; if Horizons needs a later STOP for the
    # step grid, pad by at most one step, then clamp using any "after" bound.
    def fetch_range_center(center: str, stop: str, tag: str) -> tuple[str, list[dict]]:
        return fetch_vectors(probe_id, cmd, center, range_start, stop, f"{step_days} d", tag)

    sun_text, sun_vecs = fetch_range_center("500@10", range_stop, "range")
    if not sun_vecs:
        # Try modest pad (+1 day), then (+step) but clamp to "after" hint if present.
        for pad_days, tag in [(1, "range_pad1"), (step_days, "range_padstep")]:
            trial_stop = add_days(range_stop_date, pad_days)
            sun_text, sun_vecs = fetch_range_center("500@10", trial_stop, tag)
            if sun_vecs:
                range_stop_padded = trial_stop
                break
            prior, after = extract_bound_hint(sun_text)
            if after:
                # STOP must be <= coverage end; use the after-date itself as STOP.
                a_date = after[:10]
                a_time = after[11:] if len(after) > 10 else "00:00:00"
                # Use end-of-coverage instant as STOP (Horizons includes it).
                trial_stop = f"{a_date} {a_time}"
                sun_text, sun_vecs = fetch_range_center("500@10", trial_stop, "range_clamp")
                if sun_vecs:
                    range_stop_padded = trial_stop
                    break
        else:
            range_stop_padded = range_stop
    else:
        range_stop_padded = range_stop

    if not sun_vecs:
        snippet = sun_text[:400].replace("\n", " | ")
        print(f"  FAIL range sun: {snippet[:200]}", flush=True)
        failures.append({"probe": probe_id, "range": True, "center": "sun", "snippet": snippet[:400]})
        # Fall back to milestones only (still honest).
        return {"horizonId": cmd, "waypoints": milestone_wps, "stepDays": step_days}

    earth_text, earth_vecs = fetch_range_center("500@399", range_stop_padded, "range")
    if not earth_vecs:
        # Mirror sun stop attempts for earth.
        for pad_days, tag in [(1, "range_pad1"), (step_days, "range_padstep")]:
            trial_stop = add_days(range_stop_date, pad_days)
            earth_text, earth_vecs = fetch_range_center("500@399", trial_stop, tag)
            if earth_vecs:
                break
        if not earth_vecs:
            snippet = earth_text[:400].replace("\n", " | ")
            print(f"  FAIL range earth: {snippet[:200]}", flush=True)
            failures.append({"probe": probe_id, "range": True, "center": "earth", "snippet": snippet[:400]})

    earth_by_jd = {round(v["jd"], 6): v for v in earth_vecs}
    earth_by_date = {v["date"]: v for v in earth_vecs}

    by_date: dict[str, dict] = {}
    missing_earth = 0
    for v in sun_vecs:
        # Skip samples outside the requested inclusive span.
        if parse_iso_date(v["date"]) > parse_iso_date(range_stop_date):
            continue
        if parse_iso_date(v["date"]) < parse_iso_date(range_start_date):
            continue
        ev = earth_by_jd.get(round(v["jd"], 6)) or earth_by_date.get(v["date"])
        if not ev:
            missing_earth += 1
            continue  # never ship a waypoint without earthDistAu
        wp = {
            "date": v["date"],
            "jd": v["jd"],
            "xAu": v["xAu"],
            "yAu": v["yAu"],
            "zAu": v["zAu"],
            "earthDistAu": mag(ev["xAu"], ev["yAu"], ev["zAu"]),
        }
        by_date[v["date"]] = wp
    if missing_earth:
        print(f"  WARN dropped {missing_earth} sun samples without earth match", flush=True)

    # Force-include milestones (overwrite same calendar day with labeled sample).
    for mwp in milestone_wps:
        if "earthDistAu" not in mwp:
            print(f"  WARN milestone {mwp['date']} missing earthDistAu; skipping force-include", flush=True)
            continue
        by_date[mwp["date"]] = dict(mwp)

    waypoints = sorted(by_date.values(), key=lambda w: w["jd"])

    # Cap if somehow over MAX_COUNT: keep milestones + uniform subsample of rest.
    if len(waypoints) > MAX_COUNT:
        milestone_dates = {m["date"] for m in milestone_wps}
        keep = [w for w in waypoints if w["date"] in milestone_dates]
        rest = [w for w in waypoints if w["date"] not in milestone_dates]
        budget = MAX_COUNT - len(keep)
        if budget <= 0:
            waypoints = keep[:MAX_COUNT]
        else:
            if len(rest) <= budget:
                picked = rest
            else:
                idxs = [round(i * (len(rest) - 1) / (budget - 1)) for i in range(budget)] if budget > 1 else [0]
                picked = [rest[i] for i in sorted(set(idxs))]
            waypoints = sorted(keep + picked, key=lambda w: w["jd"])

    labeled = sum(1 for w in waypoints if w.get("label"))
    print(f"  OK {len(waypoints)} waypoints ({labeled} labeled milestones)", flush=True)
    return {
        "horizonId": cmd,
        "waypoints": waypoints,
        "stepDays": step_days,
        "rangeStart": range_start_date,
        "rangeStop": range_stop_date,
    }


def body_waypoint(wp: dict) -> dict:
    """Schema-strict waypoint for body JSON (no label)."""
    out = {
        "date": wp["date"],
        "jd": wp["jd"],
        "xAu": wp["xAu"],
        "yAu": wp["yAu"],
        "zAu": wp["zAu"],
    }
    if "earthDistAu" in wp and wp["earthDistAu"] is not None:
        out["earthDistAu"] = wp["earthDistAu"]
    return out


def apply_to_bodies(results: dict) -> None:
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    for probe_id, data in results.items():
        path = BODIES / f"{probe_id}.json"
        if not path.exists():
            print(f"  SKIP apply {probe_id}: missing {path}", flush=True)
            continue
        card = json.loads(path.read_text(encoding="utf-8"))
        wps = [body_waypoint(w) for w in data["waypoints"]]
        if len(wps) < 2:
            print(f"  SKIP apply {probe_id}: <2 waypoints", flush=True)
            continue
        path_block = card.get("path") or {"frame": "heliocentric"}
        path_block["frame"] = path_block.get("frame") or "heliocentric"
        path_block["waypoints"] = wps
        card["path"] = path_block
        if "horizonId" in data and data["horizonId"]:
            card["horizonId"] = str(data["horizonId"])
        meta = card.get("meta") or {}
        if "fetchedAt" in meta:
            meta["fetchedAt"] = now
        # Keep provenance string honest; only refresh if already present.
        if "provenance" in meta:
            meta["provenance"] = (
                "path.waypoints from JPL Horizons VECTORS (CENTER=500@10 Sun, "
                "REF_PLANE=ECLIPTIC, OUT_UNITS=AU-D); earthDistAu = |r| from "
                "VECTORS CENTER=500@399 (Earth) at the same epochs. Dense mission-span "
                "sample (~40–100 pts, milestones force-included). Cached under "
                "scripts/fixtures/horizons-probes/."
            )
        card["meta"] = meta
        path.write_text(json.dumps(card, indent=2) + "\n", encoding="utf-8")
        print(f"  applied {probe_id}: {len(wps)} waypoints → {path.relative_to(ROOT)}", flush=True)


def main() -> None:
    results: dict = {}
    failures: list = []

    for probe_id, cmd, epochs in PROBES:
        data = densify_probe(probe_id, cmd, epochs, failures)
        results[probe_id] = data

    # Perseverance alternate COMMAND if primary produced too few points
    if len(results.get("perseverance", {}).get("waypoints", [])) < MIN_COUNT:
        print("=== perseverance retry COMMAND='M2020' ===", flush=True)
        alt = densify_probe("perseverance", "M2020", PROBES[-1][2], failures)
        if len(alt.get("waypoints", [])) > len(results["perseverance"].get("waypoints", [])):
            alt["horizonId"] = "M2020"
            results["perseverance"] = alt

    # Pioneer late fallbacks if still sparse (coverage holes)
    for probe_id, cmd, fallback_dates in [
        ("pioneer-10", "-23", ["2002-01-01", "2001-01-01", "1997-01-01", "1990-01-01", "1985-01-01"]),
        ("pioneer-11", "-24", ["1995-01-01", "1990-01-01", "1985-01-01", "1980-01-01"]),
    ]:
        wps = results[probe_id]["waypoints"]
        if len(wps) >= MIN_COUNT:
            continue
        print(f"=== {probe_id} late fallbacks (have {len(wps)}) ===", flush=True)
        # Re-run densify is better if milestones failed; try adding late points then re-range
        have = {w["date"] for w in wps}
        for date in fallback_dates:
            if date in have:
                continue
            wp = resolve_single_day(probe_id, cmd, date, "late_available", failures)
            if wp:
                wps.append(wp)
                have.add(wp["date"])
        wps.sort(key=lambda w: w["jd"])
        results[probe_id]["waypoints"] = wps

    OUT.write_text(
        json.dumps({"results": results, "failures": failures}, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote {OUT}", flush=True)
    for pid, data in results.items():
        print(f"  {pid}: {len(data['waypoints'])} waypoints (step={data.get('stepDays')})")

    print("=== apply to body cards ===", flush=True)
    apply_to_bodies(results)


if __name__ == "__main__":
    main()
