# Orbitpedia — solar ingest notes

## Usage (repo root)

```bash
node scripts/ingest.mjs
npm run validate:catalog
```

Writes:
- `src/data/bodies/<id>.json` — one card per body (`systemId`, `orbit.frame`, `meta.confidence`)
- `src/data/systems/solar.json` — home System doc + `memberIds`

Cache / omitted log go under `/tmp` (not committed).

## Contract
- Public HTTP only (Horizons, SSD phys_par, SBDB) — no secrets
- Omit unknowns; never invent elements
- Solar planets: `systemId: "solar"`, no `parentId`, `orbit.frame: "heliocentric"`
- Sun: no orbit
- `meta.confidence: "known"` for fetched solar seeds

## Validation
`scripts/validate-catalog.mjs` loads the catalog (`--data-dir src/data`) and asserts periapsis clearance vs central radius (EPS_AU=1e-9).


---

## Legacy notes

# Orbitpedia — catalog enrichment notes

Work dir: `/workspace/orbitpedia-enrich`  
Generated: see `meta.fetchedAt` on each body in `bodies.json`  
Validation: **PASS** (`node validate.mjs` → CatalogSchema version 1, 14 bodies)

## Deliverables

| File | Role |
|------|------|
| `schema.ts` | Additive Zod bump (`sources`, `fetchedAt`, `horizonId`, `sbdbDes`); `CatalogSchema.version` remains `1` |
| `bodies.json` | Static catalog, re-fetched from public JPL endpoints |
| `ingest.mjs` | One-shot reproducible fetch/build (no API keys / secrets) |
| `NOTES.md` | This file |
| `validate.mjs` | Local Zod check (optional helper) |

## Sources used (public HTTP only)

1. **JPL Horizons API** — `https://ssd.jpl.nasa.gov/api/horizons.api`
   - Planets + Pluto: `EPHEM_TYPE=ELEMENTS`, `CENTER=500@10`, epoch **JD 2451545.0** (J2000.0 TDB), planet-center IDs `199…999`.
   - Sun: `COMMAND=10`, `OBJ_DATA=YES`, `MAKE_EPHEM=NO` (mass, mean radius IAU2015, density, sidereal rotation).

2. **JPL SSD Planetary Physical Parameters** — `https://ssd.jpl.nasa.gov/planets/phys_par.html`
   - Mercury–Neptune + Pluto facts: mass, mean radius, bulk density, sidereal rotation (negative = retrograde), geometric albedo.
   - Mass scales: planets ×10²⁴ kg; Pluto (dwarf table) ×10¹⁸ kg.
   - HTML cached locally as `phys_par.html` by ingest for offline re-parse after first fetch.

3. **JPL SBDB API** — `https://ssd-api.jpl.nasa.gov/sbdb.api?des=…&phys-par=true&full-prec=true`
   - Ceres (`1`), Pallas (`2`), Vesta (`4`), Hygiea (`10`).
   - Full-precision osculating elements + phys-par (diameter→`radiusMeanKm`, density, albedo, `rot_per` hours→days, GM→`massKg` via CODATA 2018 `G=6.67430e-11`).

## Fields omitted (not fabricated)

| Body | Field | Why |
|------|-------|-----|
| Sun | `orbit` | Central star; no heliocentric Keplerian orbit in catalog |
| Sun | `facts.albedo` | Not provided / not meaningful in Horizons Sun phys block (seed had `0`) |
| Hygiea | `facts.densityGcm3` | Absent from SBDB `phys-par` response |

All other catalogued optional fields that SBDB/phys_par/Horizons returned were kept.

## Epoch notes

- **Planets + Pluto:** osculating elements at **JD 2451545.0** from Horizons (matches seed epoch).
- **Asteroids:** SBDB solution epoch **JD 2461200.5** (current SBDB fit), **not** J2000. Mean anomaly and angles therefore differ substantially from the seed’s J2000-ish placeholders—by design (real SBDB state vectors).
- Horizons `PR` is the **osculating** period at the request epoch (can differ slightly from mean sidereal period used in popular tables).

## Validation result

```
node validate.mjs
→ VALIDATION PASS
→ version 1, 14 bodies, preferred order
→ sun: no orbit; all others have orbit
→ horizonId set for sun + planets + pluto
→ sbdbDes set for asteroids
```

## Accuracy / provenance vs approx seed (short diff)

- **Provenance:** every body now has `meta.sources[]` with real URLs + field lists, `meta.fetchedAt`, and `horizonId` / `sbdbDes` where applicable. Seed only had a vague `meta.source` string (“approx”).
- **Planets + Pluto orbits:** replaced rounded Wikipedia-style elements with Horizons osculating ELEMENTS @ J2000. Semi-major axes largely agree (~1e-6–1e-3 rel); angles/`ma` move more where the seed used mean elements (esp. Earth node/`w` near-zero inclination, Neptune `e`/`w`/`ma`).
- **Facts (planets/Pluto):** phys_par geometric albedos replace mixed seed albedos (notable Δ: Mercury 0.088→0.106, Mars 0.25→0.15, Uranus 0.3→0.51, Pluto 0.52→0.3). Masses/radii track seed to ~1e-5–1e-4.
- **Sun:** Horizons IAU2015 radius 695700 km unchanged; mass 1.98847e30→1.98841e30; density 1.41→1.408; rotation 25.05→**25.38** d (Horizons “Adopted sid. rot. per.”); albedo omitted.
- **Asteroids:** Pallas/Hygiea no longer use coarse rounded placeholders (`a≈2.772`, `ma=40`, etc.)—full SBDB precision. Hygiea radius 217→203.56 km (diameter 407.12); rotation 1.151 d→**0.576** d (SBDB 13.828 h); mass from coarse SBDB `GM=7` km³/s² (~1.05e20 kg) replaces seed 8.32e19—**low precision, documented**. Density omitted for Hygiea.
- **Colors / ids / aliases / discoveryNotes:** preserved as specified (Sol, Terra, 1/2/4/10 designations).

## How to reproduce

```bash
cd /workspace/orbitpedia-enrich
npm install          # zod for validate.mjs only
node ingest.mjs      # network: Horizons + SBDB + phys_par
node validate.mjs
```

No NASA API keys required.
## Catalog validation (sanity)

From repo root (needs `zod` from package dependencies):

```bash
npm run validate:catalog
# or
node scripts/validate-catalog.mjs
```

Options:

- `--catalog <path>` — default `src/data/catalog/bodies.json`
- `--central-body <id>` — default first `kind=star` (else `sun`)
- `--central-radius-au <n>` — override central radius for non-solar / alternate systems
- `--strict-warnings` — fail on missing weak fields (density, albedo, provenance, ids)

Hard-fail rule: every non-central body with an orbit must have periapsis `qAu` or `aAu*(1-e)` **greater than** the central body's physical radius (au). This catches sun-intersecting (or star-intersecting) elements. Schematic viz radii are out of scope — pass a larger `--central-radius-au` only when intentionally testing clearance against a display scale.

## Viz / Kepler orbit-sanity (schematic vs physical)

Physical catalog clearance: `npm run validate:catalog` — `q > centralRadiusAu` (real km→AU).

Schematic mesh clearance + Kepler sampling: `npm test` (`scripts/orbit-sanity.mjs`):

- `q > visualRadius(sun) + visualRadius(body) + margin` (scene AU; sizeTiers — NOT true scale)
- sampled ellipse `|r|` outside **real** sun radius (au)
- `periodD ≈ 365.256363 * aAu^1.5` within 2% relative
- central star: no heliocentric orbit
- float epsilon: **1e-9 au**
- units: AU, degrees (`*Deg`), Julian Day (`epochJd`); fields `aAu,e,iDeg,omDeg,wDeg,maDeg,periodD,epochJd[,qAu]`