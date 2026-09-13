# New Orbitpedia system — one-shot must-pass

Use when adding any new planetary system (cards + Explore + System map).
Do not ship until every item is checked. No invented moons/bodies.
Archive-first sources only (human-readable pages; never raw API JSON;
never nssdc planetary factsheet).

How to build cards consistently: [DATA_SETUP.md](./DATA_SETUP.md).

## A. Catalog

- [ ] `systems/<id>.json` with memberIds, blurb, highlights, planetCount, distanceLy (if known), hostSpectralType, compactnessNote when relevant, meta.sources
- [ ] One body card per member under `bodies/`; star has no heliocentric orbit
- [ ] Planets: usable Kepler elements + `orbit.frame` (heliocentric relative to host); sparse OK with honest placeholders — never invent
- [ ] Star hook line in discoveryNotes pointing at system scale/layout
- [ ] `npm run generate:catalog` + `npm run validate:catalog`; `npm test` (orbit-sanity) green
- [ ] No secrets; lean cards

## B. Scale formulas (no per-system hacks)

- [ ] Schematic/Prop/True: host star mesh ≥ largest planet when star has largest radiusKm
- [ ] Compact systems: no planet–planet mesh intersections after helio shared scale / schematic pack
- [ ] Sol (home) still ~unchanged feel (helio ~1, Prop sun ~0.26)
- [ ] Face-on Explore: edge-on archive iDeg still honest in Facts; viz looks top-down like Sol
- [ ] Size-mode swap does **not** reset camera pose/zoom

## C. Explore (planetary / system view)

- [ ] Open via `/?system=<id>` (and Systems map Open / double-click)
- [ ] Full unload on system switch (`key={systemId}` or equivalent)
- [ ] BodyRail All: Star / Planets / Dwarf planets / Asteroids groups; moons nested if any
- [ ] Empty selection shows SystemFacts; body select shows body Facts
- [ ] Focus framing ~25% fill; starfield surrounds outer bodies
- [ ] Orbits move; WASD/fly still work; Home returns to solar

## D. System map

- [ ] New node appears; Schematic/Proportional spacing only
- [ ] Click → compact facts overlay (no always-on card grid); centers selection
- [ ] Pan (drag + WASD, Shift boost) + zoom still work
- [ ] Open Explore routes correctly

## E. Regression smoke

- [ ] Hard-refresh Sol Explore Schematic — still looks right
- [ ] Hard-refresh TRAPPIST Schematic — still face-on, star readable, no collisions
- [ ] Hard-refresh new system — all of B–D

Ship only with commit SHA(s) and a short pass/fail note against this list.

## Fixture exception

Do not ship synthetic fixture systems in the public catalog.

