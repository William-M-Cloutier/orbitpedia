import { z } from "zod";

export const BodyKindSchema = z.enum([
  "star",
  "planet",
  "dwarf_planet",
  "asteroid",
]);

export const OrbitSchema = z.object({
  epochJd: z.number(),
  aAu: z.number().positive(),
  e: z.number().min(0).max(1),
  iDeg: z.number(),
  omDeg: z.number(),
  wDeg: z.number(),
  maDeg: z.number(),
  periodD: z.number().positive().optional(),
  /** Periapsis distance (au). If omitted, validators use aAu*(1-e). */
  qAu: z.number().positive().optional(),
});

export const FactsSchema = z.object({
  massKg: z.number().positive(),
  radiusMeanKm: z.number().positive(),
  densityGcm3: z.number().positive().optional(),
  rotationPeriodD: z.number().optional(),
  albedo: z.number().min(0).max(1).optional(),
  discoveryNotes: z.string().optional(),
  /** ISO date (YYYY-MM-DD) or year (YYYY) when known; omit for antiquity / N/A. */
  discoveryDate: z.string().optional(),
});

export const BodyMetaSchema = z.object({
  source: z.string(), // keep as primary human-readable label
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
  unitsVersion: z.literal(1),
});

export const BodySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: BodyKindSchema,
  aliases: z.array(z.string()).optional(),
  facts: FactsSchema,
  orbit: OrbitSchema.optional(),
  color: z.string().optional(),
  horizonId: z.string().optional(),
  sbdbDes: z.string().optional(),
  meta: BodyMetaSchema,
});

export const CatalogSchema = z.object({
  version: z.literal(1),
  bodies: z.array(BodySchema).min(1),
});

export type BodyKind = z.infer<typeof BodyKindSchema>;
export type Orbit = z.infer<typeof OrbitSchema>;
export type Facts = z.infer<typeof FactsSchema>;
export type BodyMeta = z.infer<typeof BodyMetaSchema>;
export type Body = z.infer<typeof BodySchema>;
export type Catalog = z.infer<typeof CatalogSchema>;