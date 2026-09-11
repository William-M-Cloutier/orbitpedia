# Orbitpedia

Search, discover, and explore Solar System bodies — facts, orbits, and graphs.

**Phase 1** covers the Sun, eight planets, Pluto (dwarf planet), and asteroids Ceres, Vesta, Pallas, and Hygiea. Data is a versioned Store B catalog — system docs + per-body cards (Zod-validated v2); no database and no accounts.

## Modes

- **Explore** (`/`) — lightweight 3D orbits (React Three Fiber); select a body to highlight, camera-follow, and open the Facts panel. `/explore` redirects here. Sizes are schematic tiers, not true scale
- **Discover** (`/discover`) — cards and compare up to 4 bodies
- **Search** (`/search`) — body index; top-bar typeahead works from every mode
- **Body detail** (`/body/[id]`) — overview, key facts, orbit elements, graphs

## Stack

- Next.js App Router + TypeScript + Tailwind
- React Three Fiber + drei + three.js (client-only canvas, `frameloop="demand"`)
- Recharts (lazy / off cold Explore path)
- Zod + Store B seeds (`src/data/systems/` + `src/data/bodies/`, catalog v2)

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
