import { z } from "zod";

/** Catalog / schema version (systems + body cards). */
export const CATALOG_VERSION = 2 as const;

export const BodyKindSchema = z.enum([
  "star",
  "planet",
  "dwarf_planet",
  "asteroid",
  /** Small-body comet (heliocentric Kepler like asteroid; e must be ≤1). */
  "comet",
  /** Natural satellite (parent-frame orbit around parentId). */
  "moon",
  /** Artificial Earth satellite (geocentric frame around Earth central). */
  "satellite",
  /** Central compact host (omit orbit like a primary star). */
  "black_hole",
  /** Spacecraft / probe (omit hyperbolic Kepler this slice; Viz owns path). */
  "probe",
]);

/** Primary gravitational host kinds (multi-star / BH systems). */
export function isPrimaryHostKind(kind: z.infer<typeof BodyKindSchema>): boolean {
  return kind === "star" || kind === "black_hole";
}

export const OrbitFrameSchema = z.enum([
  "heliocentric",
  "barycentric",
  "parent",
  /** Earth-centered inertial / TEME-ish GP elements (educational viz). */
  "geocentric",
]);

export const ConfidenceSchema = z.enum(["known", "assumed", "placeholder"]);

export const OrbitSchema = z
  .object({
    /** Julian Day epoch when elements are tied to a specific epoch. */
    epochJd: z.number().optional(),
    /**
     * Semi-major axis in au (always required for schema compatibility).
     * For geocentric sats store aKm/149597870.7 and set aKm.
     */
    aAu: z.number().positive(),
    /**
     * Semi-major axis in km — required when frame is geocentric (GP/OMM).
     * Prefer this for Facts display; aAu remains the au mirror.
     */
    aKm: z.number().positive().optional(),
    e: z.number().min(0).max(1),
    iDeg: z.number(),
    omDeg: z.number(),
    wDeg: z.number(),
    maDeg: z.number(),
    periodD: z.number().positive().optional(),
    /** Periapsis distance (au). If omitted, validators use aAu*(1-e). */
    qAu: z.number().positive().optional(),
    /** Optional periapsis in km when frame is geocentric. */
    qKm: z.number().positive().optional(),
    /** Reference frame for Kepler elements. */
    frame: OrbitFrameSchema,
  })
  .superRefine((orbit, ctx) => {
    if (orbit.frame === "geocentric") {
      if (orbit.aKm == null || !(orbit.aKm > 0)) {
        ctx.addIssue({
          code: "custom",
          message: "geocentric orbit requires positive aKm",
          path: ["aKm"],
        });
      }
    }
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
  /** Operating agency / owner for artificial satellites. */
  owner: z.string().min(1).optional(),
  /** Launch date (ISO YYYY-MM-DD); prefer over discoveryDate for sats. */
  launchDate: z.string().min(1).optional(),
  /** Expected reentry (ISO date) when sourced; omit when unknown. */
  expectedReentry: z.string().min(1).optional(),
  /**
   * Archive-backed estimates: list fact keys shown with a leading ~ in UI
   * (e.g. ["massKg"]). Never invent estimates — only mark stored values.
   */
  approximateFields: z.array(z.string().min(1)).optional(),
  /**
   * Multi-star companion projected separation from primary (au).
   * Not Kepler — omit if unknown; mark approximateFields / assumed when derived.
   */
  projectedSepAu: z.number().positive().optional(),
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

export const SatelliteBlockSchema = z
  .object({
    /** Two-line element set lines (without name line) for provenance. */
    tle: z.tuple([z.string().min(1), z.string().min(1)]).optional(),
  })
  .strict();

export const MissionSchema = z
  .object({
    /** ISO date (YYYY-MM-DD) or year (YYYY). */
    launchDate: z.string().min(1).optional(),
    /** Free-text status e.g. en_route | heliopause | flyby_complete. */
    status: z.string().min(1).optional(),
    /** Body ids or human target names (Jupiter, Pluto, …). */
    targets: z.array(z.string().min(1)).optional(),
  })
  .strict();

/**
 * Honest probe trajectory / chart series — never invent points.
 * Heliocentric au positions from NASA/JPL archives (or documented published samples).
 */
export const ProbeWaypointSchema = z
  .object({
    /** Optional Julian Day for the sample. */
    jd: z.number().optional(),
    /** Optional ISO date label for charts (YYYY-MM-DD). */
    date: z.string().min(1).optional(),
    xAu: z.number(),
    yAu: z.number(),
    zAu: z.number(),
    /** Optional heliocentric distance from Earth (au) when sourced. */
    earthDistAu: z.number().nonnegative().optional(),
  })
  .strict();

export const ProbePathSchema = z
  .object({
    /** Sparse archive waypoints (launch / flybys / epochs) — omit if none. */
    waypoints: z.array(ProbeWaypointSchema).min(2).optional(),
    /** Frame for waypoint coordinates (default heliocentric ecliptic). */
    frame: z.enum(["heliocentric"]).optional(),
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
    /** NORAD catalog number for artificial satellites (GP/OMM). */
    noradCatId: z.number().int().positive().optional(),
    /** Optional satellite provenance (TLE lines). */
    satellite: SatelliteBlockSchema.optional(),
    /** Optional render hint — textureId is a registry key only (no URLs/bytes). */
    appearance: AppearanceSchema.optional(),
    /** Probe/spacecraft mission metadata (not SI facts). */
    mission: MissionSchema.optional(),
    /** Optional honest trajectory samples for probes (Viz polyline / charts). */
    path: ProbePathSchema.optional(),
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
    if (body.orbit?.frame === "geocentric") {
      if (!body.parentId) {
        ctx.addIssue({
          code: "custom",
          message: "geocentric orbit requires parentId (Earth central)",
          path: ["parentId"],
        });
      }
    }
    if (body.kind === "satellite" && body.orbit && body.orbit.frame !== "geocentric") {
      ctx.addIssue({
        code: "custom",
        message: "satellite kind should use orbit.frame geocentric",
        path: ["orbit", "frame"],
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
  /**
   * Primary host id (kind star | black_hole, omit orbit + parentId).
   * Field name kept for compat; companions/planets parent-frame to this id.
   */
  primaryStarId: z.string().min(1).optional(),
  /** Short system blurb for System cards. */
  blurb: z.string().min(1).optional(),
  /** Bullet highlights (keep short). */
  highlights: z.array(z.string().min(1)).optional(),
  planetCount: z.number().int().nonnegative().optional(),
  /** Distance from Sol in light-years (omit for home). */
  distanceLy: z.number().nonnegative().optional(),
  /**
   * ICRS right ascension in degrees (archive / SIMBAD). Omit for Sol/home
   * and when unknown — never invent.
   */
  raDeg: z.number().min(0).max(360).optional(),
  /**
   * ICRS declination in degrees. Omit for Sol/home and when unknown.
   */
  decDeg: z.number().min(-90).max(90).optional(),
  hostSpectralType: z.string().min(1).optional(),
  compactnessNote: z.string().min(1).optional(),
  /** Archive plane: any planet ≳50 M⊕ or ≳4 R⊕ (see ingest / hasGas.ts). */
  hasGas: z.boolean().optional(),
  /** Bound stars in the system (archive: sy_snum). Prefer over counting bodies. */
  starCount: z.number().int().positive().optional(),
  /**
   * Optional companion spectral types (archive index/map). Never invent —
   * omit entries when unknown; length may be < starCount - 1.
   */
  companionSpectralTypes: z.array(z.string().min(1)).optional(),
  meta: SystemMetaSchema.optional(),
})
  .superRefine((s, ctx) => {
    const hasRa = s.raDeg != null;
    const hasDec = s.decDeg != null;
    if (hasRa === hasDec) return;
    ctx.addIssue({
      code: "custom",
      message: `system ${s.id} raDeg/decDeg must both be present or both omitted`,
      path: hasRa ? ["decDeg"] : ["raDeg"],
    });
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
    const bodyById = new Map(cat.bodies.map((b) => [b.id, b]));
    for (const s of cat.systems) {
      if (!s.primaryStarId) continue;
      if (!s.memberIds.includes(s.primaryStarId)) {
        ctx.addIssue({
          code: "custom",
          message: `system ${s.id} primaryStarId not in memberIds: ${s.primaryStarId}`,
          path: ["systems"],
        });
        continue;
      }
      const primary = bodyById.get(s.primaryStarId);
      if (!primary || (primary.kind !== "star" && primary.kind !== "black_hole")) {
        ctx.addIssue({
          code: "custom",
          message: `system ${s.id} primaryStarId must be kind star|black_hole: ${s.primaryStarId}`,
          path: ["systems"],
        });
        continue;
      }
      if (primary.systemId !== s.id) {
        ctx.addIssue({
          code: "custom",
          message: `system ${s.id} primaryStarId body systemId mismatch`,
          path: ["systems"],
        });
      }
      if (primary.orbit) {
        ctx.addIssue({
          code: "custom",
          message: `system ${s.id} primary host must omit orbit (companions use parent-frame)`,
          path: ["systems"],
        });
      }
      if (primary.parentId) {
        ctx.addIssue({
          code: "custom",
          message: `system ${s.id} primary host must omit parentId`,
          path: ["systems"],
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
export type SatelliteBlock = z.infer<typeof SatelliteBlockSchema>;
export type Mission = z.infer<typeof MissionSchema>;
export type ProbeWaypoint = z.infer<typeof ProbeWaypointSchema>;
export type ProbePath = z.infer<typeof ProbePathSchema>;
export type BodyMeta = z.infer<typeof BodyMetaSchema>;
export type Body = z.infer<typeof BodySchema>;
export type SystemMeta = z.infer<typeof SystemMetaSchema>;
export type System = z.infer<typeof SystemSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;

/** Display / citation string from meta (provenance preferred). */
export function bodyProvenance(body: Pick<Body, "meta">): string {
  return body.meta.provenance ?? body.meta.source ?? "unknown";
}

/**
 * True when orbit has Kepler elements usable for path / position.
 * Stars are allowed when elements are finite (binary companions); primaries
 * typically omit orbit and stay at the system origin.
 */
export function hasUsableOrbit(
  body: Pick<Body, "orbit" | "kind">,
): body is Body & { orbit: Orbit } {
  const o = body.orbit;
  if (!o) return false;
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