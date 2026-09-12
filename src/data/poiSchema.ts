import { z } from "zod";

/** Geographic surface POI confidence — no orbital/ephemeris claims. */
export const PoiConfidenceSchema = z.enum(["known", "assumed"]);

export const PoiSourceSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
});

/**
 * Surface point of interest on a body (lat/lon geographic).
 * Kept separate from body JSON cards so Ephemeris stays clean.
 */
export const SurfacePoiSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "poi id must be kebab-case"),
    bodyId: z.string().min(1),
    name: z.string().min(1),
    /** Geographic latitude in degrees (−90…90), not orbital inclination. */
    latDeg: z.number().min(-90).max(90),
    /** Geographic longitude in degrees (−180…180), east-positive. */
    lonDeg: z.number().min(-180).max(180),
    /** 1–2 factual sentences for Explore Facts panel. */
    summary: z.string().min(1),
    elevationM: z.number().optional(),
    depthM: z.number().positive().optional(),
    sources: z.array(PoiSourceSchema).min(1),
    confidence: PoiConfidenceSchema,
  })
  .strict();

export const BodyPoisFileSchema = z
  .object({
    bodyId: z.string().min(1),
    pois: z.array(SurfacePoiSchema),
  })
  .strict()
  .superRefine((file, ctx) => {
    const ids = new Set<string>();
    for (const p of file.pois) {
      if (p.bodyId !== file.bodyId) {
        ctx.addIssue({
          code: "custom",
          message: `poi ${p.id} bodyId "${p.bodyId}" ≠ file bodyId "${file.bodyId}"`,
          path: ["pois"],
        });
      }
      if (ids.has(p.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate poi id: ${p.id}`,
          path: ["pois"],
        });
      }
      ids.add(p.id);
    }
  });

export type PoiConfidence = z.infer<typeof PoiConfidenceSchema>;
export type PoiSource = z.infer<typeof PoiSourceSchema>;
export type SurfacePoi = z.infer<typeof SurfacePoiSchema>;
export type BodyPoisFile = z.infer<typeof BodyPoisFileSchema>;
