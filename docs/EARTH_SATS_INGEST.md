# Earth satellites — Celestrak GP ingest

First-slice path: **Celestrak GP (OMM) JSON by CATNR** → Store B `kind: "satellite"` cards.

## Command

```bash
# Prefer seed fixture (no live download)
node scripts/ingest-celestrak-gp.mjs --from-seed --dry-run
node scripts/ingest-celestrak-gp.mjs --from-seed --write

# Live fetch (cached ~2h under /tmp)
node scripts/ingest-celestrak-gp.mjs --catnr 25544,20580,48274,25994,43013 --dry-run
```

Never invent elements: skip a CATNR when required GP fields are missing.

## Field map (GP / OMM → card)

| Store B | Source |
|---------|--------|
| `id` / `name` / `aliases` | Curated first-slice table in script (stable kebab ids) |
| `kind` | `"satellite"` |
| `systemId` | `earth-sats` |
| `parentId` | `earth-sats-earth` (required for geocentric) |
| `noradCatId` | GP `NORAD_CAT_ID` |
| `orbit.frame` | `"geocentric"` |
| `orbit.aKm` | Derived from mean motion (`n` rev/day) via Kepler: \(a = (\mu)^{1/3}/(n')^{2/3}\) with \(\mu=398600.4418\) km³/s² |
| `orbit.aAu` | `aKm / 149597870.7` |
| `orbit.e` | `ECCENTRICITY` |
| `orbit.iDeg` | `INCLINATION` |
| `orbit.omDeg` | `RA_OF_ASC_NODE` |
| `orbit.wDeg` | `ARG_OF_PERICENTER` |
| `orbit.maDeg` | `MEAN_ANOMALY` |
| `orbit.periodD` | `1 / MEAN_MOTION` (days) when `MEAN_MOTION` present |
| `orbit.epochJd` | From `EPOCH` when parseable |
| `orbit.qKm` / `qAu` | \(a(1-e)\) |
| `facts.owner` / `facts.launchDate` | Curated overlay or satcat when known — **omit** `expectedReentry` when unknown |
| `satellite.tle` | Optional two-line strings when provided in seed/fetch |
| `meta.sources` | Human Celestrak GP + satcat pages (not raw JSON API strings as user-facing sole link) |

## First-slice CATNRs

| id | CATNR |
|----|-------|
| `iss` | 25544 |
| `hst` | 20580 |
| `css-tianhe` | 48274 |
| `terra` | 25994 |
| `noaa-20` | 43013 |

System shell + Earth central card are owned by Earth Sats lead. This script only (re)writes `src/data/bodies/<id>.json` for those ids.

## Full catalog later

Pagination / group GP files after first-slice stub validates in Explore. Keep Celestrak usage limits (cache identical CATNR fetches).
