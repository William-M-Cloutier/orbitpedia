# Orbitpedia

Search, discover, and explore Solar System bodies — facts, orbits, and graphs.

**Phase 1** covers the Sun, eight planets, Pluto (dwarf planet), and asteroids Ceres, Vesta, Pallas, and Hygiea. Data is a versioned in-repo JSON catalog (Zod-validated); no database and no accounts.

## Modes

- **Search** (`/`) — typeahead + body index + catalog graphs
- **Discover** (`/discover`) — cards and compare up to 4 bodies
- **Explore** (`/explore`) — lightweight 3D orbits (React Three Fiber); sizes are schematic tiers, not true scale
- **Body detail** (`/body/[id]`) — overview, key facts, orbit elements, graphs

## Stack

- Next.js App Router + TypeScript + Tailwind
- React Three Fiber + drei + three.js (client-only canvas)
- Recharts
- Zod + versioned JSON seed (`src/data/catalog/`)

SI units internally; display adapters in `src/lib/units.ts`. Orbital math in `src/lib/kepler.ts`.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm run build   # production build
npm start       # serve production build
```

## Catalog notes

Orbital elements and physical parameters are approximate values labeled with sources (JPL SSD / NASA fact sheets / documented approximates). Suitable for education and exploration UI — not precision ephemerides.
