# Earth satellites — Celestrak GP ingest

Ingest path: **Celestrak GP (OMM) JSON by CATNR** → `kind: "satellite"` catalog cards.

## Command

```bash
# Prefer seed fixture (no live download)
node scripts/ingest-celestrak-gp.mjs --from-seed --dry-run
node scripts/ingest-celestrak-gp.mjs --from-seed --write

# Subset by curated group
node scripts/ingest-celestrak-gp.mjs --from-seed --group weather --dry-run

# Live fetch (cached ~2h under /tmp)
node scripts/ingest-celestrak-gp.mjs --catnr 25544,20580,48274 --dry-run
```

Never invent elements: skip a CATNR when required GP fields are missing.

## Field map (GP / OMM → card)

| Catalog field | Source |
|---------|--------|
| `id` / `name` / `aliases` | Curated seed table in script (stable kebab ids) |
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

## Curated set (LEO / polar)

Groups: `stations` | `weather` | `science`. Fixture: `scripts/fixtures/celestrak-gp-first-slice.json` (28 GP records).

| id | CATNR | group |
|----|-------|-------|
| `iss` | 25544 | stations |
| `hst` | 20580 | stations |
| `css-tianhe` | 48274 | stations |
| `terra` | 25994 | science |
| `noaa-20` | 43013 | weather |
| `noaa-19` | 33591 | weather |
| `suomi-npp` | 37849 | weather |
| `metop-b` | 38771 | weather |
| `metop-c` | 43689 | weather |
| `aqua` | 27424 | science |
| `aura` | 28376 | science |
| `landsat-8` | 39084 | science |
| `landsat-9` | 49260 | science |
| `sentinel-1a` | 39634 | science |
| `sentinel-2a` | 40697 | science |
| `sentinel-3a` | 41335 | science |
| `icesat-2` | 43613 | science |
| `swot` | 54754 | science |
| `cloudsat` | 29107 | science |
| `css-wentian` | 53239 | stations |
| `css-mengtian` | 54216 | stations |
| `noaa-18` | 28654 | weather |
| `noaa-15` | 25338 | weather |
| `sentinel-1b` | 41456 | science |
| `sentinel-2b` | 42063 | science |
| `sentinel-3b` | 43437 | science |
| `calipso` | 29108 | science |
| `gcom-w1` | 38337 | science |

**SWOT** is NORAD **54754** (not 53847 — that CATNR is Starlink).

This script only (re)writes `src/data/bodies/<id>.json` for satellite ids; after write, update `src/data/systems/earth-sats.json` `memberIds` and run `npm run generate:catalog`.

## Full catalog later

Pagination / group GP files after the seed catalog validates in Explore. Keep Celestrak usage limits (cache identical CATNR fetches). Prefer refreshing the fixture via WebFetch/GP when box TLS to Celestrak fails.
