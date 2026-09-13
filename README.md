# Orbitpedia

Interactive atlas of the Solar System and known exoplanet hosts: orbits in 3D, a Milky Way systems map, Earth satellites, probes, surface places, and comparison charts.

Built by [William Cloutier](https://github.com/William-M-Cloutier).

![Solar System Explore](docs/readme/explore-solar.png)

## What you can do

| Mode | What it is |
|------|------------|
| **Explore** | One system at a time in 3D. Follow a body, scrub time, switch Schematic / Proportional / True size. |
| **Satellite** | Earth-centered view of major LEO / polar missions (ISS, Hubble, weather & Earth-science sats). |
| **Systems** | Browse ~4,700 catalog hosts on a Milky Way backdrop. Schematic for readable spread; Proportional for sky distance. |
| **Discover** | Size strips, mass–radius plots, and distance charts for planets, moons, and asteroids. |
| **Search** | Find systems and bodies from any page. |

![Systems map](docs/readme/systems-map.png)

![Earth satellites](docs/readme/satellite.png)

![Earth and Moon](docs/readme/explore-earth-moon.png)

![Jupiter · Great Red Spot](docs/readme/explore-jupiter-poi.png)

![Voyager 1](docs/readme/explore-voyager.png)

![Discover · planets](docs/readme/discover-planets.png)

![Discover · moons & asteroids](docs/readme/discover-moons-asteroids.png)

## Sources

Orbitpedia prefers public, human-readable archives. Facts panels link back to the pages used for each body.

| Domain | Primary sources |
|--------|-----------------|
| Solar System planets & moons | [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/), [NASA Solar System Exploration](https://science.nasa.gov/solar-system/), SSD physical parameters |
| Asteroids & comets | [JPL Small-Body Database (SBDB)](https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html) |
| Earth satellites | [Celestrak](https://celestrak.org/) NORAD GP elements |
| Exoplanet hosts (archive) | [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/) (`pscomppars`) |
| Black-hole / special hosts | Curated cards with cited public references |

Values are labeled with provenance where known. The app is for education and exploration, not precision ephemerides.

## Stack

- **Next.js** (App Router) + TypeScript + Tailwind
- **React Three Fiber** / drei / three.js for Explore & Satellite
- **Recharts** for Discover and probe distance charts
- **Zod**-validated catalog (system docs + per-body cards under `src/data/`)

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm run build && npm start   # production
npm test                     # orbit sanity + UI copy gates
```

### What ships in the repo

A fresh clone includes:

- The curated Solar System (planets, major moons, selected asteroids/comets, probes, Earth sats)
- A smoke pack of ~100 exoplanet systems (graphs under `public/archive/graphs/`)
- The full systems **index** (~4,766 hosts) for the Systems map

The full per-system Explore graphs for the entire archive live under `public/archive/bulk/` and are **not** in git (large). To Visit / Explore every archive host locally:

```bash
node scripts/ingest-exoplanet-archive.mjs --all --min-planets 1
```

See [docs/ARCHIVE_INGEST.md](docs/ARCHIVE_INGEST.md) and [docs/DATA_SETUP.md](docs/DATA_SETUP.md).

## License

Private for now; intended to go public later. Do not commit secrets or credentials.
