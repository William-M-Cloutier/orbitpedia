import { BodyPoisFileSchema, type SurfacePoi } from "./poiSchema";
import earthPois from "./pois/earth.json";

/**
 * Curated surface POIs by body id — separate from Store B body cards.
 * Add new `pois/<bodyId>.json` files and register them here.
 */
const files = [earthPois];

const byBodyId = new Map<string, SurfacePoi[]>();
const byId = new Map<string, SurfacePoi>();

for (const raw of files) {
  const file = BodyPoisFileSchema.parse(raw);
  byBodyId.set(file.bodyId, file.pois);
  for (const p of file.pois) {
    byId.set(p.id, p);
  }
}

export function getPoisForBody(bodyId: string): SurfacePoi[] {
  return byBodyId.get(bodyId) ?? [];
}

export function getPoi(id: string): SurfacePoi | undefined {
  return byId.get(id);
}

export function listPoiBodyIds(): string[] {
  return [...byBodyId.keys()];
}
