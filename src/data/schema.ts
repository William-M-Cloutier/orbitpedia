import { z } from "zod";

/** Catalog / schema version for Store B (systems + body cards). */
export const CATALOG_VERSION = 2 as const;

export const BodyKindSchema = z.enum([
  "star",
  "planet",
  "dwarf_planet",
  "asteroid",
  /** Natural satellite (parent-frame orbit around parentId). */
  "moon",
]);

export const OrbitFrameSchema = z.enum([
  "heliocentric",
  "barycentric",
  "parent",
]);

export const ConfidenceSchema = z.enum(["known", "assumed", "placeholder"]);

export const OrbitSchema = z.object({
  /** Julian Day epoch when elements are tied to a specific epoch. */
  epochJd: z.number().optional(),
  aAu: z.number().positive(),
  e: z.number().min(0).max(1),
  iDeg: z.number(),
  omDeg: z.number(),
  wDeg: z.number(),
  maDeg: z.number(),
  periodD: z.number().positive().optional(),
  /** Periapsis distance (au). If omitted, validators use aAu*(1-e). */
  qAu: z.number().positive().optional(),
  /** Reference frame for Kepler elements. */
  frame: OrbitFrameSchema,
});

/** Sparse facts — radius preferred when present; other fields optional. */
export const FactsSchema = z.object({
  massKg: z.number().positive().optional(),
  radiusMeanKm: z.number().positive().optional(),
  densityGcm3: z.number().positive().optional(),
  rotationPeriodD: z.number().optional(),
  albedo: z.number().nonnegative().max(2).optional(),
  discoveryNotes: z.string().optional(),
  /** ISO date (YYYY-MM-DD) or year (YYYY) when known; omit for antiquity / N/A. */
  discoveryDate: z.string().optional(),
  /**
   * Archive-backed estimates: list fact keys shown with a leading ~ in UI
   * (e.g. ["massKg"]). Never invent estimates — only mark stored values.
   */
  approximateFields: z.array(z.string().min(1)).optional(),
});

/**
 * Provenance: prefer `provenance`; solar seeds still ship `source` (Ephemeris).
 * At least one of provenance|source is required. confidence is required (v2).
 */
export const BodyMetaSchema = z
  .object({
    provenance: z.string().min(1).optional(),
    /** Legacy human-readable label from Phase-1 / Ephemeris seeds. */
    source: z.string().min(1).optional(),
    confidence: ConfidenceSchema,
    sources: z
      .array(
        z.object({
          name: z.string(),
          url: z.string().url(),
          fields: z.array(z.string()).optional(),
        }),
      )
      .optional(),
    fetchedAt: z.string().optional(), // ISO-8601
    unitsVersion: z.literal(1).optional(),
  })
  .superRefine((meta, ctx) => {
    if (!meta.provenance && !meta.source) {
      ctx.addIssue({
        code: "custom",
        message: "meta.provenance or meta.source required",
        path: ["provenance"],
      });
    }
  });


export const AppearanceSchema = z
  .object({
    /** Registry key for a future texture pack — never a URL, path, or bytes. */
    textureId: z
      .string()
      .min(1)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "textureId must be a kebab-case registry key")
      .optional(),
  })
  .strict();

export const BodySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: BodyKindSchema,
    /** Owning system — required in v2 (loud fail if missing). */
    systemId: z.string().min(1),
    /** Parent body in the system tree (e.g. sun for planets). Optional additive. */
    parentId: z.string().min(1).optional(),
    aliases: z.array(z.string()).optional(),
    facts: FactsSchema.default({}),
    orbit: OrbitSchema.optional(),
    color: z.string().optional(),
    horizonId: z.string().optional(),
    sbdbDes: z.string().optional(),
    /** Optional render hint — textureId is a registry key only (no URLs/bytes). */
    appearance: AppearanceSchema.optional(),
    meta: BodyMetaSchema,
  })
  .superRefine((body, ctx) => {
    if (body.parentId && body.parentId === body.id) {
      ctx.addIssue({
        code: "custom",
        message: "parentId must not equal id",
        path: ["parentId"],
      });
    }
  });

/** Sparse system-level facts for Systems / Explore chrome (not body Facts). */
export const SystemMetaSchema = z.object({
  sources: z
    .array(
      z.object({
        name: z.string(),
        url: z.string().url(),
        fields: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  fetchedAt: z.string().optional(),
  confidence: ConfidenceSchema.optional(),
});

export const SystemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Exactly one system in a loaded catalog should be home. */
  home: z.boolean().optional(),
  memberIds: z.array(z.string().min(1)).min(1),
  /** Optional primary when graph is sparse / placeholder. */
  placeholderPrimaryId: z.string().min(1).optional(),
  /** Short system blurb for System cards. */
  blurb: z.string().min(1).optional(),
  /** Bullet highlights (keep short). */
  highlights: z.array(z.string().min(1)).optional(),
  planetCount: z.number().int().nonnegative().optional(),
  /** Distance from Sol in light-years (omit for home). */
  distanceLy: z.number().nonnegative().optional(),
  hostSpectralType: z.string().min(1).optional(),
  compactnessNote: z.string().min(1).optional(),
  /** Archive plane: any planet ≳50 M⊕ or ≳4 R⊕ (see ingest / hasGas.ts). */
  hasGas: z.boolean().optional(),
  meta: SystemMetaSchema.optional(),
});

export const CatalogSchema = z
  .object({
    version: z.literal(CATALOG_VERSION),
    systems: z.array(SystemSchema).min(1),
    bodies: z.array(BodySchema).min(1),
  })
  .superRefine((cat, ctx) => {
    const systemIds = new Set(cat.systems.map((s) => s.id));
    const bodyIds = new Set(cat.bodies.map((b) => b.id));
    const homes = cat.systems.filter((s) => s.home === true);
    if (homes.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: `exactly one home system required (found ${homes.length})`,
        path: ["systems"],
      });
    }
    for (const s of cat.systems) {
      for (const mid of s.memberIds) {
        if (!bodyIds.has(mid)) {
          ctx.addIssue({
            code: "custom",
            message: `system ${s.id} memberId missing body card: ${mid}`,
            path: ["systems"],
          });
        }
      }
    }
    for (const b of cat.bodies) {
      if (!systemIds.has(b.systemId)) {
        ctx.addIssue({
          code: "custom",
          message: `body ${b.id} systemId not found: ${b.systemId}`,
          path: ["bodies"],
        });
      }
      if (b.parentId && !bodyIds.has(b.parentId)) {
        ctx.addIssue({
          code: "custom",
          message: `body ${b.id} parentId not found: ${b.parentId}`,
          path: ["bodies"],
        });
      }
    }
    if (bodyIds.size !== cat.bodies.length) {
      ctx.addIssue({
        code: "custom",
        message: "duplicate body ids",
        path: ["bodies"],
      });
    }
    if (systemIds.size !== cat.systems.length) {
      ctx.addIssue({
        code: "custom",
        message: "duplicate system ids",
        path: ["systems"],
      });
    }
  });

export type BodyKind = z.infer<typeof BodyKindSchema>;
export type OrbitFrame = z.infer<typeof OrbitFrameSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type Orbit = z.infer<typeof OrbitSchema>;
export type Facts = z.infer<typeof FactsSchema>;
export type Appearance = z.infer<typeof AppearanceSchema>;
export type BodyMeta = z.infer<typeof BodyMetaSchema>;
export type Body = z.infer<typeof BodySchema>;
export type SystemMeta = z.infer<typeof SystemMetaSchema>;
export type System = z.infer<typeof SystemSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;

/** Display / citation string from meta (provenance preferred). */
export function bodyProvenance(body: Pick<Body, "meta">): string {
  return body.meta.provenance ?? body.meta.source ?? "unknown";
}

/** True when orbit has Kepler elements usable for path / position. */
export function hasUsableOrbit(
  body: Pick<Body, "orbit" | "kind">,
): body is Body & { orbit: Orbit } {
  const o = body.orbit;
  if (!o) return false;
  if (body.kind === "star") return false;
  return (
    Number.isFinite(o.aAu) &&
    o.aAu > 0 &&
    Number.isFinite(o.e) &&
    Number.isFinite(o.iDeg) &&
    Number.isFinite(o.omDeg) &&
    Number.isFinite(o.wDeg) &&
    Number.isFinite(o.maDeg)
  );
}