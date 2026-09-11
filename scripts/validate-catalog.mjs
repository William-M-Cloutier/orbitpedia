import { readFileSync } from "node:fs";
import { z } from "zod";

const BodyKindSchema = z.enum(["star", "planet", "dwarf_planet", "asteroid"]);
const OrbitSchema = z.object({
  epochJd: z.number(),
  aAu: z.number().positive(),
  e: z.number().min(0).max(1),
  iDeg: z.number(),
  omDeg: z.number(),
  wDeg: z.number(),
  maDeg: z.number(),
  periodD: z.number().positive().optional(),
});
const FactsSchema = z.object({
  massKg: z.number().positive(),
  radiusMeanKm: z.number().positive(),
  densityGcm3: z.number().positive().optional(),
  rotationPeriodD: z.number().optional(),
  albedo: z.number().min(0).max(1).optional(),
  discoveryNotes: z.string().optional(),
});
const BodyMetaSchema = z.object({
  source: z.string(),
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
  unitsVersion: z.literal(1),
});
const BodySchema = z.object({
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
const CatalogSchema = z.object({
  version: z.literal(1),
  bodies: z.array(BodySchema).min(1),
});

const raw = JSON.parse(readFileSync(new URL("./bodies.json", import.meta.url), "utf8"));
const parsed = CatalogSchema.safeParse(raw);
if (!parsed.success) {
  console.error("VALIDATION FAIL");
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}
const ids = parsed.data.bodies.map((b) => b.id);
const expected = [
  "sun","mercury","venus","earth","mars","jupiter","saturn","uranus","neptune","pluto","ceres","vesta","pallas","hygiea",
];
console.log("VALIDATION PASS");
console.log("version", parsed.data.version);
console.log("count", parsed.data.bodies.length);
console.log("ids", ids.join(", "));
console.log("order_ok", JSON.stringify(ids) === JSON.stringify(expected));
for (const b of parsed.data.bodies) {
  const hasOrbit = !!b.orbit;
  console.log(
    `- ${b.id}: kind=${b.kind} orbit=${hasOrbit} horizonId=${b.horizonId ?? "-"} sbdbDes=${b.sbdbDes ?? "-"} a=${b.orbit?.aAu ?? "-"} epoch=${b.orbit?.epochJd ?? "-"}`,
  );
}