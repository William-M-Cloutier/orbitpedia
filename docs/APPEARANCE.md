# Body appearance (procedural default)

Explore meshes always have an intentional look for **every** body — most cards
will never ship real surface maps.

## Procedural default

- Materials are chosen by **kind / traits** (rocky, gas, ice, star) plus **light**
  noise, tinted with optional body `color` when present (catalog hue stays
  dominant — rocky especially; no alien neon tints).
- Selection uses a soft shared emissive (muted intensity), not a bright rim.
- Shared material pool — lean; do not allocate per-frame or per-unique-byte maps.
- Missing or unknown `appearance.textureId`, empty registry, or a future failed
  load → **fail-open to procedural**. Never block Explore; no error toasts.

## Optional `appearance` on body cards

Additive schema only — existing cards need no change:

```json
"appearance": { "textureId": "earth-marquee" }
```

- `textureId` is a **registry key** (kebab-case). Never a URL, path, or bytes.
- Do **not** put textures in `facts` or `meta.sources` (Facts citations stay
  archive science pages).

## Map assets (later — not this slice)

No WebP dumps / no large pack in-repo this slice. Registry may stay empty.

When marquee Sol maps land (separate ticket), stay under Guard caps:

| Cap | Limit |
|-----|--------|
| Per file | ≤ 512 KB |
| Resolution | ≤ 2048² |
| Sol bodies with real maps | ≤ 12 |
| Pack total | ≤ 6 MB |
| Load | Lazy on focus |

## Related

- Schema: `src/data/schema.ts` (`AppearanceSchema`)
- Card guide: [DATA_SETUP.md](./DATA_SETUP.md) (Appearance section)
- Viz materials: `src/viz/appearance/` (`surfaceFamily`, `proceduralTextures`, `materialPool`) wired from Explore `BodyMesh`
