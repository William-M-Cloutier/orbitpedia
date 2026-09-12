# NASA Exoplanet Archive → Orbitpedia Store B (archive plane)

Plan for the **full NEA-scale dump** without bloating the curated Explore
bundle. Pair with [DATA_SETUP.md](./DATA_SETUP.md) and
[NEW_SYSTEM_CHECKLIST.md](./NEW_SYSTEM_CHECKLIST.md).

## Sol Arch lock (product)

| Plane | On disk | Loaded how | Role |
|-------|---------|------------|------|
| **Curated** | `src/data/systems/*.json` + `src/data/bodies/*.json` → `catalog.generated.ts` | Sync import via `catalog.ts` | Sol + hand showcase (TRAPPIST-1, Kepler-11, …). Deep, polished. |
| **Archive** | `public/archive/systems.index.json` + `public/archive/graphs/<systemId>.json` | Thin index OK to list; **graphs lazy-fetched** | NEA Planetary Systems dump at scale (thousands of hosts). Sparse OK. |

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
  Sparse OK — omit empty optionals; never invent moons/asteroids.
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

- **Do not clobber curated:** never write archive chunks (or curated cards) for
  `solar`, `trappist-1`, `kepler-11`, `sparse-test` unless `--force-ids` lists them.
  Showcase stays hand-enriched; archive dump skips colliding ids by default.
- **Sol stays curated** — Horizons / SSD path (`scripts/ingest.mjs`), not NEA.
- **No invented moons** for exoplanet systems.
- Default importer is **bounded** (`--limit N` systems) so CI does not pull ~6k hosts.

## Importer

```bash
# Bounded sample (default --limit 100); writes public/archive only
npm run ingest:nea-sample

# Smaller smoke
node scripts/ingest-exoplanet-archive.mjs --limit 5

# Dry-run (no writes)
node scripts/ingest-exoplanet-archive.mjs --limit 5 --dry-run

# Named hosts (still skips protected unless --force-ids)
node scripts/ingest-exoplanet-archive.mjs --hosts "KOI-351,AU Mic"
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

Explore / Systems map can adopt the async helpers incrementally without
regenerating the curated catalog.

## Scale notes (open for Sol Arch)

- Full `pscomppars` multi-planet set is **thousands** of systems / tens of
  thousands of bodies if single-planet hosts are included later.
- On-disk: one JSON graph per system keeps diffs and lazy loads tractable;
  index stays small (id + a few summary fields).
- **Open questions:** commit full dump vs generate in CI/release? cap single-
  planet hosts? CDN / object storage when graphs exceed comfortable git size?
  Whether Systems map should show archive nodes before a graph has been fetched
  (index-only stub radii)?

## Checklist when expanding the dump

1. Run bounded ingest; spot-check overview URLs and sparse cards.
2. Confirm protected curated ids untouched.
3. `generate:catalog` + `validate:catalog` + `npm test` still green (curated).
4. Smoke: ≥1 archive chunk + index row; `getSystemGraphAsync` resolves it.
5. Do **not** add archive graphs to `catalog.generated.ts`.
