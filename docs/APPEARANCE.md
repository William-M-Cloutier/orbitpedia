# Body appearance (procedural default + marquee maps)

Explore meshes always have an intentional look for **every** body — most cards
will never ship real surface maps.

## Procedural default

- Materials are chosen by **kind / traits** (rocky, gas, ice, star) plus **light**
  noise, tinted with optional body `color` when present (catalog hue stays
  dominant — rocky especially; no alien neon tints).
- **Gas** family: clear latitudinal bands + subtle turbulence/swirls (shared
  grayscale map × catalog tint).
- **Ice** family: softer bands + frost mottling (ice giants / bright moons).
- Selection uses a soft shared emissive (muted intensity), not a bright rim.
- Shared material pool — lean; do not allocate per-frame or per-unique-byte maps.
- Missing or unknown `appearance.textureId`, empty registry entry, or a failed
  load → **fail-open to procedural**. Never block Explore; no error toasts.

## Optional `appearance` on body cards

Additive schema only — existing cards need no change:

```json
"appearance": { "textureId": "earth-marquee" }
```

- `textureId` is a **registry key** (kebab-case). Never a URL, path, or bytes.
- Do **not** put textures in `facts` or `meta.sources` (Facts citations stay
  archive science pages).

## Marquee Sol maps (this slice)

Lean WebP under Guard caps, served from `public/textures/`, registered in
`TEXTURE_REGISTRY`, lazy-loaded when the body is in-scene / focused.

| Cap | Limit |
|-----|--------|
| Per file | ≤ 512 KB |
| Resolution | ≤ 2048² |
| Sol bodies with real maps | ≤ 12 |
| Pack total | ≤ 6 MB |
| Load | Lazy on focus / near (async TextureLoader) |

### Seeded `textureId`s

| Key | Body | Source / license |
|-----|------|------------------|
| `earth-marquee` | Earth | NASA SVS Blue Marble (public domain) — resized 2048×1024 WebP |
| `moon-marquee` | Moon | NASA lunar mosaic (Clementine-class; public domain) — 1024×512 WebP |
| `mars-marquee` | Mars | NASA/USGS Viking color mosaic derivative — 1024×512 WebP |
| `jupiter-marquee` | Jupiter | NASA/JPL/SSI Cassini cylindrical map [PIA07782](https://photojournal.jpl.nasa.gov/catalog/PIA07782) — 2048×1024 WebP |
| `venus-marquee` | Venus | NASA/JPL Magellan radar mosaic (public domain) — 2048×1024 WebP |
| `saturn-marquee` | Saturn | NASA/Cassini-derived globe only (no rings; [Solar System Scope](https://www.solarsystemscope.com/textures/) 2k, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) — 2048×1024 WebP |
| `uranus-marquee` | Uranus | NASA/Voyager-derived ([Solar System Scope](https://www.solarsystemscope.com/textures/) 2k, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) — 2048×1024 WebP |
| `neptune-marquee` | Neptune | NASA/Voyager-derived ([Solar System Scope](https://www.solarsystemscope.com/textures/) 2k, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) — 2048×1024 WebP |
| `sun-marquee` | Sun | NASA SDO-derived ([Solar System Scope](https://www.solarsystemscope.com/textures/) 2k, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) — 2048×1024 WebP |

Compress offline; no TIFFs / no huge sources in-repo. Residual: 3 Sol slots
and ~5 MB remain within the ≤12 / ≤6 MB pack budget.

Mapped materials use the albedo map with white tint so continents / bands read
true; procedural path unchanged for unmapped bodies.

## Related

- Schema: `src/data/schema.ts` (`AppearanceSchema`)
- Card guide: [DATA_SETUP.md](./DATA_SETUP.md) (Appearance section)
- Viz materials: `src/viz/appearance/` (`surfaceFamily`, `proceduralTextures`,
  `materialPool`, `textureRegistry`, `textureLoader`) wired from Explore `BodyMesh`
