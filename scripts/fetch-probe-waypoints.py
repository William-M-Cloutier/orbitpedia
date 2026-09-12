#!/usr/bin/env python3
"""Fetch sparse Horizons VECTORS for Orbitpedia probe path.waypoints."""
from __future__ import annotations

import json
import math
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "horizons-probes"
FIXTURES.mkdir(parents=True, exist_ok=True)
OUT = FIXTURES / "waypoints-parsed.json"

# (id, horizon_cmd, [(date, label), ...])
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
            ("1995-09-30", "late"),  # try late mission
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


def horizons_url(command: str, center: str, start: str, stop: str) -> str:
    params = {
        "format": "text",
        "COMMAND": f"'{command}'",
        "EPHEM_TYPE": "'VECTORS'",
        "CENTER": f"'{center}'",
        "START_TIME": f"'{start}'",
        "STOP_TIME": f"'{stop}'",
        "STEP_SIZE": "'1 d'",
        "VEC_TABLE": "'2'",
        "REF_PLANE": "'ECLIPTIC'",
        "OUT_UNITS": "'AU-D'",
        "OBJ_DATA": "'NO'",
    }
    return "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(params)


def next_day(iso: str) -> str:
    y, m, d = map(int, iso.split("-"))
    # rough calendar advance (enough for Horizons stop > start)
    import datetime as dt

    t = dt.date(y, m, d) + dt.timedelta(days=1)
    return t.isoformat()


def fetch(url: str, cache_path: Path) -> str:
    if cache_path.exists() and cache_path.stat().st_size > 100:
        return cache_path.read_text(encoding="utf-8", errors="replace")
    req = urllib.request.Request(url, headers={"User-Agent": "Orbitpedia-ephemeris/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        text = resp.read().decode("utf-8", errors="replace")
    cache_path.write_text(text, encoding="utf-8")
    time.sleep(0.35)  # be polite
    return text


VEC_RE = re.compile(
    r"(?P<jd>\d+\.\d+)\s*=\s*A\.D\.\s*(?P<label>[^\n]+)\n"
    r"\s*X\s*=\s*(?P<x>[+\-]?\d+\.\d+E[+\-]\d+)\s*"
    r"Y\s*=\s*(?P<y>[+\-]?\d+\.\d+E[+\-]\d+)\s*"
    r"Z\s*=\s*(?P<z>[+\-]?\d+\.\d+E[+\-]\d+)",
    re.MULTILINE,
)


def parse_first_vector(text: str) -> dict | None:
    if "$$SOE" not in text or "$$EOE" not in text:
        return None
    if "No ephemeris" in text or "Cannot" in text or "No matching" in text:
        return None
    if "ERROR" in text.upper() and "$$SOE" not in text.split("ERROR")[0][-200:]:
        # crude; still try parse
        pass
    block = text.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    m = VEC_RE.search(block)
    if not m:
        return None
    return {
        "jd": float(m.group("jd")),
        "xAu": float(m.group("x")),
        "yAu": float(m.group("y")),
        "zAu": float(m.group("z")),
        "horizonsLabel": m.group("label").strip(),
    }


def mag(x: float, y: float, z: float) -> float:
    return math.sqrt(x * x + y * y + z * z)


def main() -> None:
    results: dict = {}
    failures: list = []

    for probe_id, cmd, epochs in PROBES:
        print(f"=== {probe_id} ({cmd}) ===", flush=True)
        waypoints = []
        for date, label in epochs:
            stop = next_day(date)
            sun_cache = FIXTURES / f"{probe_id}_{date}_sun.txt"
            earth_cache = FIXTURES / f"{probe_id}_{date}_earth.txt"
            sun_url = horizons_url(cmd, "500@10", date, stop)
            earth_url = horizons_url(cmd, "500@399", date, stop)

            sun_text = fetch(sun_url, sun_cache)
            sun_vec = parse_first_vector(sun_text)
            if not sun_vec:
                # save failure snippet
                snippet = sun_text[:500].replace("\n", " | ")
                print(f"  FAIL sun {date} ({label}): {snippet[:200]}", flush=True)
                failures.append({"probe": probe_id, "date": date, "center": "sun", "snippet": snippet[:400]})
                # try alternate dates for last-available cases
                continue

            earth_text = fetch(earth_url, earth_cache)
            earth_vec = parse_first_vector(earth_text)
            earth_dist = None
            if earth_vec:
                earth_dist = mag(earth_vec["xAu"], earth_vec["yAu"], earth_vec["zAu"])
            else:
                print(f"  WARN earth range missing {date}", flush=True)
                failures.append({"probe": probe_id, "date": date, "center": "earth", "note": "no vector"})

            wp = {
                "date": date,
                "jd": sun_vec["jd"],
                "xAu": sun_vec["xAu"],
                "yAu": sun_vec["yAu"],
                "zAu": sun_vec["zAu"],
                "label": label,
            }
            if earth_dist is not None:
                wp["earthDistAu"] = earth_dist
            waypoints.append(wp)
            print(
                f"  OK {date} ({label}): r={mag(wp['xAu'], wp['yAu'], wp['zAu']):.4f} au"
                + (f" earth={earth_dist:.4f}" if earth_dist else ""),
                flush=True,
            )

        results[probe_id] = {"horizonId": cmd, "waypoints": waypoints}

    # Perseverance alternate ID M2020 if -168 failed all
    if not results.get("perseverance", {}).get("waypoints"):
        print("=== perseverance retry COMMAND='M2020' ===", flush=True)
        alt = []
        for date, label in PROBES[-1][2]:
            stop = next_day(date)
            sun_cache = FIXTURES / f"perseverance-M2020_{date}_sun.txt"
            earth_cache = FIXTURES / f"perseverance-M2020_{date}_earth.txt"
            sun_text = fetch(horizons_url("M2020", "500@10", date, stop), sun_cache)
            sun_vec = parse_first_vector(sun_text)
            if not sun_vec:
                print(f"  FAIL M2020 sun {date}", flush=True)
                failures.append({"probe": "perseverance", "date": date, "cmd": "M2020"})
                continue
            earth_text = fetch(horizons_url("M2020", "500@399", date, stop), earth_cache)
            earth_vec = parse_first_vector(earth_text)
            earth_dist = mag(earth_vec["xAu"], earth_vec["yAu"], earth_vec["zAu"]) if earth_vec else None
            wp = {
                "date": date,
                "jd": sun_vec["jd"],
                "xAu": sun_vec["xAu"],
                "yAu": sun_vec["yAu"],
                "zAu": sun_vec["zAu"],
                "label": label,
                "cmd": "M2020",
            }
            if earth_dist is not None:
                wp["earthDistAu"] = earth_dist
            alt.append(wp)
            print(f"  OK M2020 {date}", flush=True)
        results["perseverance"] = {"horizonId": "M2020" if alt else "-168", "waypoints": alt}

    # Pioneer late-date fallbacks if needed
    for probe_id, cmd, fallback_dates in [
        ("pioneer-10", "-23", ["2002-01-01", "2001-01-01", "1997-01-01", "1990-01-01", "1985-01-01"]),
        ("pioneer-11", "-24", ["1995-01-01", "1990-01-01", "1985-01-01", "1980-01-01"]),
    ]:
        wps = results[probe_id]["waypoints"]
        if len(wps) >= 3:
            continue
        print(f"=== {probe_id} late fallbacks (have {len(wps)}) ===", flush=True)
        have = {w["date"] for w in wps}
        for date in fallback_dates:
            if date in have:
                continue
            stop = next_day(date)
            sun_cache = FIXTURES / f"{probe_id}_{date}_sun.txt"
            earth_cache = FIXTURES / f"{probe_id}_{date}_earth.txt"
            sun_text = fetch(horizons_url(cmd, "500@10", date, stop), sun_cache)
            sun_vec = parse_first_vector(sun_text)
            if not sun_vec:
                print(f"  FAIL {date}", flush=True)
                failures.append({"probe": probe_id, "date": date, "fallback": True})
                continue
            earth_text = fetch(horizons_url(cmd, "500@399", date, stop), earth_cache)
            earth_vec = parse_first_vector(earth_text)
            earth_dist = mag(earth_vec["xAu"], earth_vec["yAu"], earth_vec["zAu"]) if earth_vec else None
            wp = {
                "date": date,
                "jd": sun_vec["jd"],
                "xAu": sun_vec["xAu"],
                "yAu": sun_vec["yAu"],
                "zAu": sun_vec["zAu"],
                "label": "late_available",
            }
            if earth_dist is not None:
                wp["earthDistAu"] = earth_dist
            wps.append(wp)
            print(f"  OK fallback {date}", flush=True)
            if len(wps) >= 3:
                break

    OUT.write_text(json.dumps({"results": results, "failures": failures}, indent=2), encoding="utf-8")
    print(f"Wrote {OUT}", flush=True)
    for pid, data in results.items():
        print(f"  {pid}: {len(data['waypoints'])} waypoints")


if __name__ == "__main__":
    main()
