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
| `black_hole` | **none** (central host, same as primary star) | none |
| `planet` / `dwarf_planet` / `asteroid` | Kepler + `frame: "heliocentric"` (relative to **host**, not SSB for exoplanets) | omit (or star id only if you need tree hints — Sol planets omit) |
| `moon` | Kepler + `frame: "parent"` | **required** `parentId` |
| `satellite` | Kepler + `frame: "geocentric"` + **`aKm`** (aAu = aKm/149597870.7) | **required** `parentId` → Earth central |

`primaryStarId` names the primary **host** (`star` | `black_hole`); field name kept for compat.
For black holes, optional `facts.radiusMeanKm` may be the Schwarzschild radius derived from a cited mass (mark `approximateFields`); omit rather than invent.

### Facts (sparse OK)

| Field | Notes |
|-------|--------|
| `radiusMeanKm` | Prefer always when known (drives viz) |
| `massKg` | SI kg; omit if only an upper bound (e.g. Kepler-11 g) |
| `densityGcm3` | Only if source-backed |
| `rotationPeriodD` | Sidereal days; negative = retrograde |
| `albedo` | Geometric; omit if unknown |
| `discoveryDate` | `YYYY` or `YYYY-MM-DD`; omit for antiquity / N/A stars |
| `owner` / `launchDate` / `expectedReentry` | Artificial satellites — omit `expectedReentry` when unknown |
| `discoveryNotes` | Short; **star** / **black_hole** hosts should include a system-scale hook |

Do **not** fill unknowns with zeros or Wikipedia guesses.

Facts / UI copy is **human astronomy**. Thresholds and field names (`hasGas`,
`pl_bmasse`, `pl_rade`, ingest flags) live in code comments and docs only —
never in blurbs, highlights, discoveryNotes, tooltips, or other user-facing
strings. `npm test` runs `scripts/check-ui-copy.mjs`.

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
maps — that look must stay intentional. Gas/ice procedurals use banded looks.

Optional additive field (omit on existing cards):

```json
"appearance": { "textureId": "earth-marquee" }
```

- `textureId` = registry key only (kebab-case). **No** URLs, paths, or bytes on the card.
- Fail-open: missing key / empty registry / failed load → procedural; never block Explore.
- Keep textures **out of** `facts` and `meta.sources` (citations stay science pages).
- Marquee Sol maps live under Guard caps: ≤512KB/file, ≤2048², ≤20 Sol maps,
  ≤8MB pack, lazy on focus/near. See [APPEARANCE.md](./APPEARANCE.md) for seeded keys.


## Earth satellites (`earth-sats`)

Dedicated Explore system (not `home`). Central card `earth-sats-earth` (kind
`planet`, **no orbit**, `earth-marquee` ok) + members with `kind: "satellite"`,
`orbit.frame: "geocentric"`, `noradCatId`, and Celestrak GP provenance.

- Prefer optional `orbit.aKm` (required by refine when geocentric); keep `aAu`
  as `aKm / 149597870.7` for schema compatibility.
- Store real `periodD` from mean motion (`1/n`); do **not** use solar Kepler-3.
- Optional `satellite.tle` two-line strings for provenance (ISS seed included).
- Exclude from Systems map star layout via `isSkyMapExcludedSystemId` (Sky UI
  should not treat this as an exoplanet host).
- Never invent orbital elements — Celestrak GP/OMM only.

### Geocentric Explore scale (viz-only)

Catalog `aKm` / `aAu` stay honest. Explore amplifies **altitude above R⊕** so
LEO rings clear the Earth mesh (`GEOCENTRIC_ALT_AMPLIFY = 12` in
`sizeTiers.ts`):

`sceneA = earthVis × (1 + 12 × (aKm − R⊕) / R⊕)` then `scale = sceneA / aAu`.

Sol Explore is unchanged (heliocentric / parent-frame paths only).

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

## Archive dump (NEA scale)

Full NASA Exoplanet Archive ingest does **not** write curated
`systems/` / `bodies/` cards. It writes the archive plane under
`public/archive/` (thin `systems.index.json` + per-system
`graphs/<id>.json`) so `catalog.generated.ts` stays curated-only.

See [ARCHIVE_INGEST.md](./ARCHIVE_INGEST.md). Sample:

```bash
npm run ingest:nea-sample
# or: node scripts/ingest-exoplanet-archive.mjs --limit 5
```

Lazy load helpers: `src/data/archiveCatalog.ts`
(`listSystemsAsync`, `getSystemGraphAsync`).

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

## Probes (`kind: probe`)

Additive spacecraft cards on solar (and later other systems):

- Required: `id`, `name`, `kind: "probe"`, `systemId`, `meta` (+ Sources), usually `horizonId` (JPL Horizons spacecraft ID, e.g. `-31`).
- Optional `mission`: `{ launchDate, status, targets[] }` — real NASA/JPL values only.
- Optional `path`: `{ waypoints: [{ jd?, date?, xAu, yAu, zAu, earthDistAu? }, ...] }` — sparse **archive** heliocentric samples only (never invent). Viz draws polyline; charts may use `earthDistAu` / derived distances when sourced.
- **Omit `orbit`** when the trajectory is hyperbolic escape (`OrbitSchema.e` is ≤1). Viz owns path/icon; do not invent Kepler elements or waypoints.
- Explore this slice: **marker-only** placement (octahedron icon outside the outer planet display apo). **Not an ephemeris / not a trajectory** — placeholders until `path.waypoints` (Arch-owned schema). Selectable via focusId/onSelect; no OrbitLine without usable Kepler.
- `facts.discoveryNotes` may summarize the mission factually (no process meta).

