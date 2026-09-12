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
- Extra columns (v2): `sy_snum` (star count), `cb_flag` (circumbinary).

## Filter defaults (dump v2 — William lock)

| Flag / setting | Default | Meaning |
|----------------|---------|---------|
| `--min-planets` | **1** | Include single-planet hosts (`sy_pnum >= 1`) |
| `--include-single-planet` | sets min=1 | Kept for compat (redundant with default) |
| `--limit` | **100** | Bounded smoke / sample (git-friendly) |
| `--all` | off | No system cap — **full dump** into bulk plane |

**Never commit `--all` into `public/archive/graphs/`.**

| Plane | When | Path |
|-------|------|------|
| **Smoke (git)** | `--limit` ≤ 100 (default) | `public/archive/` |
| **Bulk (gitignored)** | `--all` or `--limit` > 100 | `public/archive/bulk/` |
| **Override** | `ARCHIVE_OUT=/path` | that directory (`systems.index.json` + `graphs/`) |

Full dump = CI/release artifact or local cache under the bulk plane — not a fat
main-branch commit. Committed smoke stays small (e.g. `--limit 100`).

## Multi-star families

Hostnames that share a **family key** are merged into one system:

- `familyKey(hostname)` strips a trailing single-letter / N / S suffix
  (`"55 Cnc A"` / `"55 Cnc B"` → `"55 Cnc"`).
- `systemId` = kebab of the family key (e.g. `55-cnc`).
- Companion **star body** ids use `<systemId>-comp-<letter>` so they do not
  collide with planet ids like `55-cnc-b`.
- `sy_snum` drives how many `kind:star` bodies are emitted; remaining slots
  after archive-backed siblings become **placeholders**
  (`id: <systemId>-star-N`, `meta.confidence: "placeholder"`, neutral color
  `#9aa3ad`, no invented spectype/mass/teff/orbit).
- `cb_flag === 1` → system / index `circumbinary: true`.

## What we write (hosts + planets + stars)

Per archive system chunk `graphs/<systemId>.json`:

```json
{
  "system": {
    "id", "name", "memberIds", "primaryStarId", "planetCount", "starCount",
    "distanceLy?", "hostSpectralType?", "hasGas", "circumbinary?", "blurb?", "meta"
  },
  "bodies": [ /* N stars (primary + comps + placeholders) + planets */ ]
}
```

- Star cards: **primary has no orbit**; mass/radius from `st_mass` / `st_rad` when
  present. Companion stars + placeholders set `parentId` → `primaryStarId` (Orbit Viz
  Explore rail) but **omit `orbit`** unless real NEA binary elements exist (none
  invented). Placeholders: `kind:star`, `meta.confidence: "placeholder"`, no
  invented spectype/mass/teff/orbit.
- Planet cards: if `pl_orbsmax` present → Kepler elements with
  `orbit.frame: "heliocentric"` (host-centric). If missing/invalid → **omit
  `orbit` entirely** but still emit the planet card when mass/radius/discovery
  facts exist. Planets without `a` sort after those with `a`.
- Absolute Ω / M usually unpublished → `omDeg: 0`, `maDeg: 0`,
  `meta.confidence: "assumed"` with a short note in `meta.source`.
- Missing `e` → `0` (assumed); missing `iDeg` → `90` (assumed, transit-typical).
- **`pl_orbsmax` is no longer required** to ingest a planet row.
- Sparse OK — omit empty optionals; never invent moons/asteroids. Planet cards omit
  `parentId`; companion/placeholder **stars** set `parentId` → primary (no orbit).

Thin index `systems.index.json`:

```json
{
  "version": 1,
  "fetchedAt": "<ISO>",
  "source": "NASA Exoplanet Archive pscomppars",
  "systems": [
    {
      "id", "name", "planetCount", "starCount", "distanceLy?",
      "hostSpectralType?", "hasGas", "circumbinary?", "overviewUrl", "primaryStarId?"
    }
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
# Bounded sample (default --limit 100, --min-planets 1)
npm run ingest:nea-sample
# or:
node scripts/ingest-exoplanet-archive.mjs --limit 100 --min-planets 1

# Smaller smoke
node scripts/ingest-exoplanet-archive.mjs --limit 5

# Dry-run (no writes)
node scripts/ingest-exoplanet-archive.mjs --limit 5 --dry-run

# Named hosts (still skips protected unless --force-ids)
node scripts/ingest-exoplanet-archive.mjs --hosts "KOI-351,AU Mic"

# Explicit single-planet (same as default min-planets 1)
node scripts/ingest-exoplanet-archive.mjs --include-single-planet --limit 50

# Full dump → gitignored public/archive/bulk/
node scripts/ingest-exoplanet-archive.mjs --all --min-planets 1

# Or explicit output dir (CI artifact)
ARCHIVE_OUT=/tmp/orbitpedia-nea-bulk node scripts/ingest-exoplanet-archive.mjs --all --min-planets 1

# Large limit also goes to bulk (not the committed smoke plane)
node scripts/ingest-exoplanet-archive.mjs --limit 500 --min-planets 1
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

- Default includes singles (`sy_pnum >= 1`); raise `--min-planets` to narrow.
- On-disk: one JSON graph per system; index stays small.
- **Full `--all`:** writes `public/archive/bulk/` (gitignored) or `ARCHIVE_OUT` —
  **not** `public/archive/graphs/`. Sample/`--limit 100` stays the committed smoke plane.
- Index: single `systems.index.json` OK until ~5k; paginate/shard only if needed.

## Facts copy (no process meta)

Archive Facts / System blurbs are **factual-or-omit**:

- Do **not** write process phrases into user-facing copy (`Archive host`, `ingest slice`,
  `sample ingest`, `hand-enriched`, `Phase 1 catalog`, `Orbitpedia catalog`,
  `Archive system (sparse)`, `load the full graph`, lazy-load wiring notes, etc.).
- Star `discoveryNotes` omitted unless a real archive note exists; prefer `discoveryDate`.
- System `blurb` = hostname + optional spectral type + confirmed planet count + distance when known.
- Facts/UI = human astronomy; thresholds/field names only in code comments + docs.

## hasGas filter (index + system chunk)

Archive index rows and system chunks include boolean **`hasGas`**:

- `true` if **any** planet in the ingest slice has archive `pl_bmasse` ≳ **50 M⊕**
  **or** `pl_rade` ≳ **4 R⊕** (either threshold is enough).
- `false` if no planet meets those thresholds (including when mass/radius are missing
  — we do **not** invent gas giants from incomplete rows).

Systems map **Has gas giant** (Filters popover) requires `hasGas === true` and
ANDs with spectral / planet-count / ★ Fav. Empty = don't care; rows missing the
flag are excluded while the filter is on (do not invent). Curated Sol derives
locally from bodies with the same 50 M⊕ / 4 R⊕ cuts (Jupiter/Saturn).

Re-run smoke (`--limit 100`) after changing thresholds. Full pack requires
re-ingest into `public/archive/bulk/` (`--all`); committed smoke alone is not enough.

## TAP row window (important)

NEA ADQL `TOP` applies to **planet rows**, not host systems. For `--all`, the
importer currently fetches at most **`TAP_ROW_CAP_ALL = 20000`** rows
(`sy_pnum >= --min-planets`; **`pl_orbsmax` not required**), then groups by
**family** (multi-star merge). Bounded `--limit N` uses `TOP max(N*12, 200)`
rows, then takes the first N families.

```bash
# Census vs current window (no writes)
node scripts/ingest-exoplanet-archive.mjs --all --min-planets 1 --verify
node scripts/ingest-exoplanet-archive.mjs --limit 100 --min-planets 1 --verify
```

`--verify` reports hosts/families with and without `pl_orbsmax` (a is optional).

## Checklist when expanding the dump

1. Run bounded ingest (`--limit 100`); spot-check overview URLs and sparse cards.
2. Confirm protected curated ids untouched.
3. `generate:catalog` + `validate:catalog` + `npm test` still green (curated).
4. Smoke: ≥1 archive chunk + index row; `getSystemGraphAsync` resolves it.
5. Do **not** add archive graphs to `catalog.generated.ts`.
6. Before `--all`: Guard sign-off; run into `public/archive/bulk/` or `ARCHIVE_OUT` only.
7. Spot-check: `starCount` on index; multi-star graphs have N star bodies; some
   planets omit `orbit`; single-planet systems present; blurbs stay factual.

## Multi-star / single-planet / no-aAu (William overnight)

- **`starCount`** ← NEA `sy_snum` on index + system; Filters bins 1 / 2 / 3+.
- **`primaryStarId`** on system; Explore shows **N** `kind:star` members.
- Companions: archive-backed when sibling hostname exists; else `meta.confidence: placeholder`
  (no invented spectype/mass/orbit). Companions set `parentId` → primary for rail; omit `orbit`
  unless archive has real binary elements.
- **`circumbinary`** when `cb_flag==1`.
- **Single-planet** hosts included (`--min-planets 1` / default for this dump).
- **no-aAu** planets: omit `orbit` entirely; Facts stay sparse/honest — never invent a.

## Body discoveryNotes (archive)

Planets set `facts.discoveryNotes` from NEA when available (omit on `kind:star` — planet discovery year/method is misleading on the host):

- `Discovered {disc_year} ({discoverymethod}).` — or year-only / method-only if one is missing.
- Omit when both absent. No wiki in default ingest (optional later flag).
- Sky Overview composes `discoveryDate` + `discoveryNotes` (no `facts.overview` field).

