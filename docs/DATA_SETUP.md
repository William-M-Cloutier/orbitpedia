# Orbitpedia data setup guide

How to build **consistent** Store B cards when mass-producing systems.
Pair with [NEW_SYSTEM_CHECKLIST.md](./NEW_SYSTEM_CHECKLIST.md) (ship gates).
Do not invent bodies, moons, or numbers. Sparse + honest beats fake-complete.

## Layout (Store B)

```
src/data/
  systems/<systemId>.json   # small System doc
  bodies/<bodyId>.json      # one card per body
```

After any add/edit:

```bash
npm run generate:catalog
npm run validate:catalog
npm test   # orbit-sanity
```

Never hand-edit `catalog.generated.ts`.

## Naming

| Thing | Rule | Examples |
|-------|------|----------|
| `systemId` / system file | kebab-case, stable | `solar`, `trappist-1`, `kepler-11` |
| Body `id` | kebab-case; exoplanets `host-letter` | `earth`, `trappist-1-b`, `kepler-11-g` |
| Star body `id` | usually equals `systemId` | `trappist-1`, `kepler-11` |
| `name` | human display string | `TRAPPIST-1 b`, `Kepler-11` |

Exactly **one** system has `"home": true` (`solar`).

## System doc (`systems/*.json`)

Required: `id`, `name`, `memberIds` (includes the star).

Recommended for Explore / Systems map:

- `blurb` — 1–2 sentences
- `highlights[]` — short bullets (compactness, planet count story, host type)
- `planetCount`
- `distanceLy` — omit for Sol
- `hostSpectralType`
- `compactnessNote` — when packed vs Sol is non-obvious (TRAPPIST, Kepler-11)
- `meta.sources` + `meta.fetchedAt` + `meta.confidence`

`memberIds` order: star first, then planets by increasing semi-major axis, then
dwarfs/asteroids, moons either after their parent or listed anywhere as long as
`parentId` is set on the moon card.

## Body card (`bodies/*.json`)

### Required on every body

- `id`, `name`, `kind`, `systemId`
- `meta.confidence` (`known` \| `assumed` \| `placeholder`)
- `meta.source` and/or `meta.provenance` (human string)
- Prefer `meta.sources[{ name, url, fields[] }]` + `meta.fetchedAt`

### Kind rules

| Kind | Orbit | Parent |
|------|-------|--------|
| `star` | **none** | none |
| `planet` / `dwarf_planet` / `asteroid` | Kepler + `frame: "heliocentric"` (relative to **host**, not SSB for exoplanets) | omit (or star id only if you need tree hints — Sol planets omit) |
| `moon` | Kepler + `frame: "parent"` | **required** `parentId` |

### Facts (sparse OK)

| Field | Notes |
|-------|--------|
| `radiusMeanKm` | Prefer always when known (drives viz) |
| `massKg` | SI kg; omit if only an upper bound (e.g. Kepler-11 g) |
| `densityGcm3` | Only if source-backed |
| `rotationPeriodD` | Sidereal days; negative = retrograde |
| `albedo` | Geometric; omit if unknown |
| `discoveryDate` | `YYYY` or `YYYY-MM-DD`; omit for antiquity / N/A stars |
| `discoveryNotes` | Short; **star** should include a system-scale hook |

Do **not** fill unknowns with zeros or Wikipedia guesses.

### Orbit

- Always set `frame`.
- Exoplanet hosts: `heliocentric` means **host-centric** (document that in `meta.source`).
- If absolute Ω / M are unpublished, set `omDeg: 0`, `maDeg: 0` and mark `confidence: "assumed"` with a note in `meta.source` (same pattern as TRAPPIST / Kepler-11).
- Keep catalog `iDeg` honest (transit systems ~90°). Explore applies face-on viz; Facts stay true.
- Optional `qAu`; validators use `aAu*(1-e)` if omitted.
- Optional `periodD`; prefer archive period when available.

### Color

Optional hex for rail / mesh tint. Keep readable on dark UI; one stable color per body.

### Appearance (procedural + optional textureId)

Explore always draws a **procedural** surface by kind/traits (rocky / gas / ice /
star + light noise; uses `color` when helpful). Most bodies will never have real
maps — that look must stay intentional.

Optional additive field (omit on existing cards):

```json
"appearance": { "textureId": "some-registry-key" }
```

- `textureId` = registry key only (kebab-case). **No** URLs, paths, or bytes on the card.
- Fail-open: missing key / empty registry / failed load → procedural; never block Explore.
- Keep textures **out of** `facts` and `meta.sources` (citations stay science pages).
- No map asset pack this slice. Future Guard caps: ≤512KB/file, ≤2048², ≤12 Sol maps,
  ≤6MB pack, lazy on focus. Marquee Sol maps = later ticket.

See [APPEARANCE.md](./APPEARANCE.md).

## Sources policy (locked)

**Allow (human-readable pages people can open):**

- NASA Exoplanet Archive **overview** pages  
  `https://exoplanetarchive.ipac.caltech.edu/overview/...`
- JPL Horizons **app** / documentation pages  
  `https://ssd.jpl.nasa.gov/horizons/app.html`
- SSD phys_par, SBDB lookup pages
- NASA Solar System Exploration pages

**Forbid in `meta.sources[].url`:**

- Raw API/JSON endpoints (`horizons.api`, `sbdb.api?…` as the cited link, etc.)
- `nssdc.gsfc.nasa.gov` planetary factsheets (bad Firefox HSTS/cert for users)

Ingest scripts may *fetch* APIs; the **cited** URL for Facts links must still be a browsable page. List which fields each source supports in `fields[]`.

## Confidence

| Value | When |
|-------|------|
| `known` | Directly from primary archive tables / phys pages |
| `assumed` | Needed for viz (e.g. Ω=0, M=0) or soft defaults called out in meta |
| `placeholder` | Explicit temporary stub — rare; prefer omit |

## What not to invent

- Moons / asteroids for exoplanet systems without established archive objects
- Masses that are only upper limits (omit or note in discoveryNotes — no fake point mass)
- Orbits for the central star
- Per-body scale hacks in viz (formulas in `src/viz/sizeTiers.ts` only)

## Mass-production recipe

1. Pick system; confirm archive overview URL.
2. Write System doc (facts + memberIds).
3. Write star card (no orbit; system hook in discoveryNotes).
4. Write planet cards innermost→outward (elements + radius; mass if known).
5. Moons only if real + `parent` frame + `parentId`.
6. `generate:catalog` → `validate:catalog` → `npm test`.
7. Run [NEW_SYSTEM_CHECKLIST.md](./NEW_SYSTEM_CHECKLIST.md) (scale, face-on, map, Sol regression).
8. Ship with SHA + short pass/fail note.

## Related

- Ship gates: `docs/NEW_SYSTEM_CHECKLIST.md`
- Solar ingest mechanics: `scripts/INGEST_NOTES.md`
- Schema: `src/data/schema.ts` (CATALOG_VERSION = 2)
- Appearance / procedural: `docs/APPEARANCE.md`

## UI fixture: `sparse-test`

`systemId: sparse-test` (“Sparse Test (fixture)”) is a **non-science** catalog system for Facts / dials / charts edge cases (missing mass → Unknown, omitted albedo, `~` approximateFields, moon with parent, etc.).

- Marked in blurb/highlights as a UI fixture — exclude from real-system polish expectations.
- Values are placeholders for Explore scale / Kepler gates only; omit fields rather than invent science numbers when testing “missing”.
- Still must pass `validate:catalog` + `orbit-sanity` (structural gates).

### `facts.approximateFields`

Optional string list of fact keys whose **stored** values should render with a leading `~` (archive-backed estimates). Cite the estimate in `meta.sources`. Never invent estimates just to fill the UI.

