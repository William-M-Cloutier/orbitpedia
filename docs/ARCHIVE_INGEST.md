# NASA Exoplanet Archive → Orbitpedia Store B (archive plane)

Plan for the **full NEA-scale dump** without bloating the curated Explore
bundle. Pair with [DATA_SETUP.md](./DATA_SETUP.md) and
[NEW_SYSTEM_CHECKLIST.md](./NEW_SYSTEM_CHECKLIST.md).

## Sol Arch lock (product)

| Plane | On disk | Loaded how | Role |
|-------|---------|------------|------|
| **Curated** | `src/data/systems/*.json` + `src/data/bodies/*.json` → `catalog.generated.ts` | Sync import via `catalog.ts` | Sol + hand showcase (TRAPPIST-1, Kepler-11, …). Deep, polished. |
| **Archive** | `public/archive/systems.index.json` + `public/archive/graphs/<systemId>.json` | Thin index OK to list; **graphs lazy-fetched** | NEA Planetary Systems dump at scale. Sparse OK. |

**Never** embed thousands of body cards in `catalog.generated.ts` / the client
bundle. `generate:catalog` must stay curated-only.

## Source

- **Table:** NASA Exoplanet Archive Planetary Systems Composite Parameters
  (`pscomppars`) via TAP (`/TAP/sync`) or bulk CSV of the same columns.
- **Fetch** may use TAP/CSV; **cited** `meta.sources[].url` must be human
  overview pages only, e.g.
  `https://exoplanetarchive.ipac.caltech.edu/overview/<hostname>`
  (never TAP/JSON/API query URLs in `meta.sources`).
- Public HTTP only — no API keys / secrets.

## Filter defaults (dump v1)

| Flag / setting | Default | Meaning |
|----------------|---------|---------|
| `--min-planets` | **2** | Multi-planet hosts only (`sy_pnum >= 2`) |
| `--include-single-planet` | off | Sets `--min-planets 1` when you explicitly want singles |
| `--limit` | **100** | Bounded smoke / sample (git-friendly) |
| `--all` | off | No system cap — **full multi-planet dump** |

**Hold `--all` in git.** Full dump (~thousands of multi-planet hosts) is a
**CI/release artifact or local cache**, not a fat main-branch commit. Keep a
small sample in `public/archive/` for smoke (e.g. `--limit 100` on `843338a`).

## What we write (hosts + planets + stars only)

Per archive system chunk `graphs/<systemId>.json`:

```json
{
  "system": { "id", "name", "memberIds", "planetCount", "distanceLy?", "hostSpectralType?", "blurb?", "meta" },
  "bodies": [ /* star + planets */ ]
}
```

- Star card: no heliocentric orbit; mass/radius from `st_mass` / `st_rad` when present.
- Planet cards: Kepler elements with `orbit.frame: "heliocentric"` (host-centric).
  Sparse OK — omit empty optionals; never invent moons/asteroids; omit `parentId`.
- Absolute Ω / M usually unpublished → `omDeg: 0`, `maDeg: 0`,
  `meta.confidence: "assumed"` with a short note in `meta.source`.
- Missing `e` → `0` (assumed); missing `iDeg` → `90` (assumed, transit-typical).
- Skip rows without `pl_orbsmax` (schema requires `aAu`).
- Binary companion hostnames (`55 Cnc B`) get system ids
  `<primary>-comp-<letter>` so they do not collide with planet ids like
  `55-cnc-b` on the primary host.

Thin index `systems.index.json`:

```json
{
  "version": 1,
  "fetchedAt": "<ISO>",
  "source": "NASA Exoplanet Archive pscomppars",
  "systems": [
    { "id", "name", "planetCount", "distanceLy?", "hostSpectralType?", "overviewUrl" }
  ]
}
```

## Guardrails

- **Do not clobber curated:** never write archive chunks for
  `solar`, `trappist-1`, `kepler-11`, `sparse-test` unless `--force-ids` lists them.
- **Sol stays curated** — Horizons / SSD path (`scripts/ingest.mjs`), not NEA.
- **No invented moons** for exoplanet systems.
- Default importer is **bounded** (`--limit N`) so CI does not pull the full dump.

## Importer

```bash
# Bounded multi-planet sample (default --limit 100, --min-planets 2)
npm run ingest:nea-sample
# or:
node scripts/ingest-exoplanet-archive.mjs --limit 100 --min-planets 2

# Smaller smoke
node scripts/ingest-exoplanet-archive.mjs --limit 5

# Dry-run (no writes)
node scripts/ingest-exoplanet-archive.mjs --limit 5 --dry-run

# Named hosts (still skips protected unless --force-ids)
node scripts/ingest-exoplanet-archive.mjs --hosts "KOI-351,AU Mic"

# Single-planet hosts (explicit opt-in)
node scripts/ingest-exoplanet-archive.mjs --include-single-planet --limit 50

# Full multi-planet dump — ARTIFACT PATH (do not fat-commit to main)
# Write to a release/CI output dir or local cache, then host outside fat git.
node scripts/ingest-exoplanet-archive.mjs --all --min-planets 2
```

After ingest, curated gates must still pass unchanged:

```bash
npm run generate:catalog
npm run validate:catalog
```

## Facade (lazy Explore)

`src/data/catalog.ts` stays curated-sync for Sol / showcase.

`src/data/archiveCatalog.ts`:

- `listArchiveSystems()` — thin index (fetch `/archive/systems.index.json`)
- `getArchiveSystemGraph(id)` — fetch `/archive/graphs/<id>.json`
- `getSystemGraphAsync(id)` — curated sync hit first, else archive fetch
- `listSystemsAsync()` — curated `listSystems()` ∪ archive index (archive ids
  omitted when a curated system already owns that id)

Systems map shows archive **index stubs**; graph loads on Explore open.

## Scale notes

- Multi-planet (`sy_pnum >= 2`) set is the v1 dump target; singles later via
  `--include-single-planet`.
- On-disk: one JSON graph per system; index stays small.
- **Full `--all`:** produce as CI/release artifact or local cache — **not**
  thousands of graphs committed to main long-term. Sample stays in git for smoke.
- Index: single `systems.index.json` OK until ~5k; paginate/shard only if needed.

## Checklist when expanding the dump

1. Run bounded ingest (`--limit 100`); spot-check overview URLs and sparse cards.
2. Confirm protected curated ids untouched.
3. `generate:catalog` + `validate:catalog` + `npm test` still green (curated).
4. Smoke: ≥1 archive chunk + index row; `getSystemGraphAsync` resolves it.
5. Do **not** add archive graphs to `catalog.generated.ts`.
6. Before `--all`: Guard sign-off on `public/archive` weight + artifact hosting plan.
